/**
 * Server-only client for the RantAI decision server (docker/decision/server.py), which serves
 * decision models (System One typed decisions) that vLLM and Ollama cannot.
 *
 * Config (frontend env; both stay on the server, the browser never sees the token):
 *   DECISION_BASE_URL       e.g. http://decision:8000. Empty = the feature is hidden.
 *   DECISION_ADMIN_TOKEN    the server's admin token, needed to load/unload models.
 *
 * A finished decision job is deployed by NAME from its recorded model folder: the server mounts
 * the same Transformer Lab data volume, so the path TL recorded is valid there too.
 */
import { DECISION_SUBTYPE } from "@/lib/finetune";
import { listAllJobs } from "@/lib/tasks-server";

const baseUrl = () => (process.env.DECISION_BASE_URL ?? "").trim().replace(/\/+$/, "");
const adminToken = () => process.env.DECISION_ADMIN_TOKEN ?? "";

export const decisionConfigured = () => baseUrl() !== "";

export type DecisionModel = {
  name: string;
  path: string;
  loaded: boolean;
  error: string | null;
  load_in_4bit: boolean;
  max_seq_length: number;
  loaded_at: number | null;
};

export type DecisionServerState = {
  configured: boolean;
  reachable: boolean;
  adminEnabled: boolean;
  models: DecisionModel[];
  maxModels: number | null;
  error?: string;
};

export type DeployableDecisionJob = { id: string; name: string; path: string; deployedAs: string | null };

/** An error from the decision server, carrying its HTTP status so a route can pass it on. */
export class DecisionServerError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

const NO_TOKEN = "The decision server admin token is not configured (DECISION_ADMIN_TOKEN)";

async function dsFetch(
  path: string,
  init: RequestInit & { admin?: boolean; timeoutMs?: number } = {}
): Promise<Response> {
  const { admin, timeoutMs = 15_000, headers, ...rest } = init;
  return fetch(`${baseUrl()}${path}`, {
    ...rest,
    headers: { "Content-Type": "application/json", ...(admin ? { "X-Admin-Token": adminToken() } : {}), ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function errorOf(res: Response): Promise<DecisionServerError> {
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  const message = body.error?.message ?? `The decision server answered ${res.status}`;
  // The server refusing OUR admin token is a misconfiguration of this deployment, not the browser
  // user's fault: never hand it on as a 401/403 (the UI would read it as "you are logged out").
  if (res.status === 401 || res.status === 403) {
    return new DecisionServerError(`The decision server refused the admin token (check DECISION_ADMIN_TOKEN): ${message}`, 502);
  }
  // A server-side failure is a bad gateway from the browser's point of view.
  return new DecisionServerError(message, res.status >= 500 && res.status !== 507 && res.status !== 503 ? 502 : res.status);
}

const finished = (status: string) => ["COMPLETE", "COMPLETED"].includes(status.toUpperCase());

export async function decisionServerState(): Promise<DecisionServerState> {
  const empty: DecisionServerState = {
    configured: decisionConfigured(),
    reachable: false,
    adminEnabled: false,
    models: [],
    maxModels: null,
  };
  if (!empty.configured) return empty;
  try {
    const health = await dsFetch("/health", { timeoutMs: 5_000 });
    if (!health.ok) return { ...empty, error: `The decision server answered ${health.status}` };
  } catch {
    return { ...empty, error: "The decision server is not reachable" };
  }
  if (!adminToken()) return { ...empty, reachable: true };
  try {
    const res = await dsFetch("/admin/models", { admin: true });
    if (!res.ok) return { ...empty, reachable: true, error: (await errorOf(res)).message };
    const body = (await res.json()) as { models?: DecisionModel[]; max_models?: number };
    return { ...empty, reachable: true, adminEnabled: true, models: body.models ?? [], maxModels: body.max_models ?? null };
  } catch {
    return { ...empty, reachable: true, error: "Could not list the served models" };
  }
}

/** The folder of the decision model inside a job's recorded model paths, or null. The job may also
 *  record a merged or GGUF folder; only `..._unsloth_decision_model` is the adapter + head. */
export function decisionModelDir(models: string[]): string | null {
  return models.find((m) => /_unsloth_decision_model\/?$/.test(m)) ?? null;
}

/** A readable, server-safe default name for a deployed model. */
export function defaultDeployName(taskName: string, jobId: string): string {
  const slug = taskName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, 48);
  return slug || `decision-${jobId.slice(0, 8)}`;
}

/** Finished decision jobs that have a model folder, each flagged with the served name if deployed. */
export async function deployableDecisionJobs(served: DecisionModel[]): Promise<DeployableDecisionJob[]> {
  const rows = await listAllJobs();
  return rows
    .filter((r) => r.subtype === DECISION_SUBTYPE && finished(r.status))
    .flatMap((r) => {
      const path = decisionModelDir(r.models);
      if (!path) return [];
      const live = served.find((m) => m.path === path);
      return [{ id: r.id, name: r.template, path, deployedAs: live?.name ?? null }];
    });
}

export async function deployDecisionJob(
  jobId: string,
  opts: { name?: string; loadIn4bit?: boolean; maxSeqLength?: number } = {}
): Promise<DecisionModel> {
  if (!adminToken()) throw new DecisionServerError(NO_TOKEN, 503);
  const job = (await listAllJobs()).find((r) => r.id === jobId);
  if (!job || job.subtype !== DECISION_SUBTYPE) throw new DecisionServerError("That is not a decision job", 404);
  if (!finished(job.status)) throw new DecisionServerError("The job has not finished", 409);
  const path = decisionModelDir(job.models);
  if (!path) throw new DecisionServerError("The job has no saved decision model", 409);
  let name = opts.name?.trim() || defaultDeployName(job.template, job.id);
  if (!opts.name?.trim()) {
    // Two jobs with the same task name (a retrain) would both default to one served name; give the
    // second one the job id instead of a 409 that can only be solved by unloading the first.
    const served = (await decisionServerState()).models;
    if (served.some((m) => m.name === name && m.path !== path)) name = `${name.slice(0, 55)}-${job.id.slice(0, 8)}`;
  }
  const res = await dsFetch("/admin/models", {
    method: "POST",
    admin: true,
    timeoutMs: 600_000, // loading an 8B model takes a minute or more
    body: JSON.stringify({
      name,
      path,
      load_in_4bit: opts.loadIn4bit ?? false,
      max_seq_length: opts.maxSeqLength ?? 4096,
    }),
  });
  if (!res.ok) throw await errorOf(res);
  return (await res.json()) as DecisionModel;
}

export async function undeployDecision(name: string): Promise<void> {
  if (!adminToken()) throw new DecisionServerError(NO_TOKEN, 503);
  const res = await dsFetch(`/admin/models/${encodeURIComponent(name)}`, { method: "DELETE", admin: true });
  if (!res.ok) throw await errorOf(res);
}

/** Ask a served model directly (the "Try it" box). Goes to the server, not through the gateway. */
export async function decisionPredict(body: { model: string; state: unknown; questions: unknown }): Promise<unknown> {
  // Longer than the server's queue timeout (120 s), so a busy model answers 503 instead of this aborting.
  const res = await dsFetch("/v1/systemone", { method: "POST", body: JSON.stringify(body), timeoutMs: 150_000 });
  if (!res.ok) throw await errorOf(res);
  return res.json();
}
