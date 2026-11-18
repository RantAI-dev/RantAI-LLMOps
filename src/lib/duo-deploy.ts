/**
 * Duo pair deployment (docs/RENCANA-DUO.md, phase D3): change the model or LoRA adapter behind System 1 or System 2
 * of the Rantai-Aql gateway from LLMOps, without Portainer.
 *
 * The gateway calls fixed addresses (`aql-s1:8001` model `system1`, `aql-s2:8002` model `system2`), so a new model
 * needs no gateway change: this module recreates the vLLM container behind that alias and serves the new base (or the
 * base plus an adapter named `system1` / `system2`) under the same name. The previous container is kept stopped as
 * `<name>-prev`; if the new one is not answering within the time limit, it is removed and the previous one comes back.
 *
 * Needs the Docker socket (DOCKER_SOCKET, default /var/run/docker.sock). Server-only.
 */
import {
  dockerAvailable,
  dockerCreate,
  dockerInspect,
  dockerRemove,
  dockerRename,
  dockerStart,
  dockerStop,
  dockerUpdate,
} from "@/lib/docker-client";
import { isSafeAdapterPath } from "@/lib/vllm-lora";

export type DuoRole = "s1" | "s2";

type RoleSpec = {
  label: string;
  container: string;
  alias: string;
  port: number;
  served: string;
  maxNumSeqs: number;
  gpuUtil: string;
  /** System 2 thinks; System 1 must not have a reasoning parser (vLLM would stream its answer as reasoning). */
  reasoningParser: string | null;
};

export const DUO_ROLES: Record<DuoRole, RoleSpec> = {
  s1: { label: "System 1", container: "aql-s1", alias: "aql-s1", port: 8001, served: "system1", maxNumSeqs: 4, gpuUtil: "0.08", reasoningParser: null },
  s2: { label: "System 2", container: "aql-s2", alias: "aql-s2", port: 8002, served: "system2", maxNumSeqs: 2, gpuUtil: "0.12", reasoningParser: "qwen3" },
};

const TL_DATA_VOL = process.env.VLLM_TL_DATA_VOLUME ?? "rantai-llmops_tl_data";
const READY_TIMEOUT_MS = Number(process.env.DUO_DEPLOY_READY_TIMEOUT_MS ?? 20 * 60_000);
const HF_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

export type DuoDeployRequest = { role: DuoRole; baseModel: string; adapterPath: string | null; maxModelLen: number };

export class DuoDeployError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

/** Checks a browser request body; returns the deployment to run or throws DuoDeployError(400). */
export function parseDuoDeployRequest(body: unknown): DuoDeployRequest {
  if (!body || typeof body !== "object") throw new DuoDeployError("Invalid JSON body", 400);
  const b = body as { role?: unknown; baseModel?: unknown; adapterPath?: unknown; maxModelLen?: unknown };
  if (b.role !== "s1" && b.role !== "s2") throw new DuoDeployError("`role` must be s1 or s2", 400);
  if (typeof b.baseModel !== "string" || !HF_ID.test(b.baseModel)) {
    throw new DuoDeployError("`baseModel` must be a Hugging Face model id (owner/name)", 400);
  }
  let adapterPath: string | null = null;
  if (b.adapterPath !== undefined && b.adapterPath !== null && b.adapterPath !== "") {
    if (typeof b.adapterPath !== "string" || !isSafeAdapterPath(b.adapterPath)) {
      throw new DuoDeployError("`adapterPath` must be a trained adapter under /root/.transformerlab/", 400);
    }
    adapterPath = b.adapterPath;
  }
  const maxModelLen = b.maxModelLen ?? 8192;
  if (typeof maxModelLen !== "number" || !Number.isInteger(maxModelLen) || maxModelLen < 1024 || maxModelLen > 32768) {
    throw new DuoDeployError("`maxModelLen` must be a whole number from 1024 to 32768", 400);
  }
  return { role: b.role, baseModel: b.baseModel, adapterPath, maxModelLen };
}

/**
 * The `vllm serve` arguments for a role (the image's entrypoint is `vllm serve`). With an adapter, the base is served
 * as `<name>-base` and the adapter under the name the gateway calls, so the gateway's requests reach the adapter.
 */
export function vllmArgs(role: DuoRole, r: Pick<DuoDeployRequest, "baseModel" | "adapterPath" | "maxModelLen">): string[] {
  const s = DUO_ROLES[role];
  const args = [
    r.baseModel,
    "--served-model-name",
    r.adapterPath ? `${s.served}-base` : s.served,
    "--port",
    String(s.port),
    "--dtype",
    "bfloat16",
    "--max-model-len",
    String(r.maxModelLen),
    "--max-num-seqs",
    String(s.maxNumSeqs),
    // The gateway's ShadowPrefill and cached-token accounting need these two.
    "--enable-prefix-caching",
    "--enable-prompt-tokens-details",
    "--max-logprobs",
    "5",
    "--gpu-memory-utilization",
    s.gpuUtil,
  ];
  if (s.reasoningParser) args.push("--reasoning-parser", s.reasoningParser);
  if (r.adapterPath) args.push("--enable-lora", "--max-lora-rank", "64", "--lora-modules", `${s.served}=${r.adapterPath}`);
  return args;
}

export type DuoRoleCurrent = {
  exists: boolean;
  running: boolean;
  image: string | null;
  baseModel: string | null;
  adapterPath: string | null;
  maxModelLen: number | null;
};

/** What a role's container serves now, read from `docker inspect`. */
export function readCurrent(inspect: unknown): DuoRoleCurrent {
  const j = (inspect && typeof inspect === "object" ? inspect : {}) as {
    Config?: { Image?: string; Cmd?: string[] };
    State?: { Running?: boolean };
  };
  const cmd = Array.isArray(j.Config?.Cmd) ? j.Config!.Cmd! : [];
  const after = (flag: string) => {
    const i = cmd.indexOf(flag);
    return i >= 0 && i + 1 < cmd.length ? cmd[i + 1] : null;
  };
  const lora = after("--lora-modules");
  const len = Number(after("--max-model-len"));
  return {
    exists: Boolean(j.Config),
    running: j.State?.Running === true,
    image: j.Config?.Image ?? null,
    baseModel: cmd[0] && !cmd[0].startsWith("-") ? cmd[0] : null,
    adapterPath: lora && lora.includes("=") ? lora.slice(lora.indexOf("=") + 1) : null,
    maxModelLen: Number.isFinite(len) && len > 0 ? len : null,
  };
}

type Mount = { Type?: string; Name?: string; Source?: string; Destination?: string; RW?: boolean };

/** The create body for the new container: the old one's image, env, GPU, IPC and mounts, with new arguments. */
export function containerBody(role: DuoRole, old: unknown, r: DuoDeployRequest): Record<string, unknown> {
  const s = DUO_ROLES[role];
  const o = (old ?? {}) as {
    Config?: { Image?: string; Env?: string[]; Entrypoint?: string[] | null };
    HostConfig?: Record<string, unknown>;
    Mounts?: Mount[];
    NetworkSettings?: { Networks?: Record<string, unknown> };
  };
  const hc = o.HostConfig ?? {};
  // Every mount spelled out (a volume by name), so nothing silently becomes a fresh anonymous volume.
  const mounts = (o.Mounts ?? []).flatMap((m) =>
    m.Destination && (m.Type === "volume" || m.Type === "bind")
      ? [{ Type: m.Type, Source: m.Type === "volume" ? m.Name : m.Source, Target: m.Destination, ReadOnly: m.RW === false }]
      : []
  );
  if (r.adapterPath && !mounts.some((m) => m.Target === "/root/.transformerlab")) {
    mounts.push({ Type: "volume", Source: TL_DATA_VOL, Target: "/root/.transformerlab", ReadOnly: true });
  }
  const network = Object.keys(o.NetworkSettings?.Networks ?? {})[0] ?? (hc.NetworkMode as string) ?? "rantai-llmops_llmops";
  return {
    Image: o.Config?.Image ?? "vllm/vllm-openai:cu130-nightly",
    ...(o.Config?.Entrypoint ? { Entrypoint: o.Config.Entrypoint } : {}),
    Cmd: vllmArgs(role, r),
    Env: o.Config?.Env ?? [],
    HostConfig: {
      Mounts: mounts,
      NetworkMode: network,
      RestartPolicy: { Name: "unless-stopped" },
      ...(hc.DeviceRequests ? { DeviceRequests: hc.DeviceRequests } : { DeviceRequests: [{ Driver: "nvidia", Count: -1, Capabilities: [["gpu"]] }] }),
      ...(hc.Runtime ? { Runtime: hc.Runtime } : {}),
      ...(hc.IpcMode ? { IpcMode: hc.IpcMode } : {}),
      ...(hc.ShmSize ? { ShmSize: hc.ShmSize } : {}),
    },
    NetworkingConfig: { EndpointsConfig: { [network]: { Aliases: [s.alias] } } },
  };
}

// ---------------------------------------------------------------------------------------------------
// Jobs (one per role at a time, kept in this server process)
// ---------------------------------------------------------------------------------------------------
export type DuoDeployPhase = "replacing" | "loading" | "ready" | "failed" | "rolled_back";
export type DuoDeployJob = {
  role: DuoRole;
  request: DuoDeployRequest;
  phase: DuoDeployPhase;
  message: string;
  startedAt: number;
  finishedAt: number | null;
};

const jobs = new Map<DuoRole, DuoDeployJob>();

export function duoDeployJobs(): Partial<Record<DuoRole, DuoDeployJob>> {
  return Object.fromEntries(jobs.entries());
}

const ok = (status: number) => status >= 200 && status < 300;
const detail = (r: { json: unknown; text: string }) => (r.json as { message?: string } | null)?.message ?? r.text.slice(0, 200);

/** Whether the role answers under the name the gateway calls. */
async function serving(role: DuoRole): Promise<boolean> {
  const s = DUO_ROLES[role];
  try {
    const res = await fetch(`http://${s.alias}:${s.port}/v1/models`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const j = (await res.json()) as { data?: Array<{ id?: string }> };
    return (j.data ?? []).some((m) => m.id === s.served);
  } catch {
    return false;
  }
}

/** Put `<name>-prev` back as the role's container (used after a failed deployment and by the rollback button). */
async function restorePrevious(role: DuoRole): Promise<void> {
  const name = DUO_ROLES[role].container;
  const prev = `${name}-prev`;
  if ((await dockerInspect(prev)).status !== 200) throw new DuoDeployError(`No ${prev} container to go back to`, 409);
  await dockerStop(name, 20).catch(() => {});
  await dockerRemove(name).catch(() => {});
  const renamed = await dockerRename(prev, name);
  if (!ok(renamed.status)) throw new DuoDeployError(`Renaming ${prev} failed: ${detail(renamed)}`, 502);
  await dockerUpdate(name, { RestartPolicy: { Name: "unless-stopped" } });
  const started = await dockerStart(name);
  if (!ok(started.status) && started.status !== 304) throw new DuoDeployError(`Starting ${name} failed: ${detail(started)}`, 502);
}

async function waitReady(role: DuoRole, timeoutMs: number, pollMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await serving(role)) return true;
    const st = await dockerInspect(DUO_ROLES[role].container).catch(() => null);
    if (st && st.status === 200 && (st.json as { State?: { Status?: string } })?.State?.Status === "exited") return false;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return false;
}

/** The deployment itself; updates the job as it goes. Exported for tests. */
export async function runDuoDeploy(job: DuoDeployJob, opts: { timeoutMs?: number; pollMs?: number } = {}): Promise<void> {
  const { role, request } = job;
  const name = DUO_ROLES[role].container;
  const prev = `${name}-prev`;
  const set = (phase: DuoDeployPhase, message: string) => {
    job.phase = phase;
    job.message = message;
    if (phase === "ready" || phase === "failed" || phase === "rolled_back") job.finishedAt = Date.now();
  };
  try {
    const old = await dockerInspect(name);
    if (old.status !== 200) throw new DuoDeployError(`${name} does not exist; start it once from Portainer`, 409);
    const body = containerBody(role, old.json, request);
    // Keep exactly one previous container.
    await dockerStop(prev, 5).catch(() => {});
    await dockerRemove(prev).catch(() => {});
    await dockerStop(name, 20);
    const renamed = await dockerRename(name, prev);
    if (!ok(renamed.status)) throw new DuoDeployError(`Renaming ${name} failed: ${detail(renamed)}`, 502);
    await dockerUpdate(prev, { RestartPolicy: { Name: "no" } });
    const created = await dockerCreate(name, body);
    if (created.status !== 201) {
      await restorePrevious(role);
      set("rolled_back", `Creating the container failed (${created.status}: ${detail(created)}); the previous one is back`);
      return;
    }
    const started = await dockerStart(name);
    if (!ok(started.status)) {
      await restorePrevious(role);
      set("rolled_back", `Starting the container failed (${detail(started)}); the previous one is back`);
      return;
    }
    set("loading", "Loading the model (a first download can take several minutes)");
    if (await waitReady(role, opts.timeoutMs ?? READY_TIMEOUT_MS, opts.pollMs ?? 10_000)) {
      set("ready", `${DUO_ROLES[role].label} serves ${request.baseModel}${request.adapterPath ? " with the adapter" : ""}`);
      return;
    }
    await restorePrevious(role);
    set("rolled_back", "The new model did not answer in time (see the container log); the previous one is back");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Never leave the role without a running container: bring back whichever one is there.
    try {
      const now = await dockerInspect(name);
      if (now.status !== 200 && (await dockerInspect(prev)).status === 200) {
        await restorePrevious(role);
        set("rolled_back", `${msg}; the previous one is back`);
        return;
      }
      if (now.status === 200 && (now.json as { State?: { Running?: boolean } })?.State?.Running !== true) await dockerStart(name);
    } catch {
      /* report the first error */
    }
    set("failed", msg);
  }
}

/** Starts a deployment in the background; one per role at a time. */
export function startDuoDeploy(r: DuoDeployRequest): DuoDeployJob {
  if (!dockerAvailable()) throw new DuoDeployError("The Docker socket is not mounted on this frontend (DOCKER_SOCKET)", 503);
  const cur = jobs.get(r.role);
  if (cur && (cur.phase === "replacing" || cur.phase === "loading")) {
    throw new DuoDeployError(`${DUO_ROLES[r.role].label} is already being replaced`, 409);
  }
  const job: DuoDeployJob = { role: r.role, request: r, phase: "replacing", message: "Replacing the container", startedAt: Date.now(), finishedAt: null };
  jobs.set(r.role, job);
  void runDuoDeploy(job);
  return job;
}

/** Brings `<name>-prev` back. */
export async function rollbackDuoRole(role: DuoRole): Promise<void> {
  if (!dockerAvailable()) throw new DuoDeployError("The Docker socket is not mounted on this frontend (DOCKER_SOCKET)", 503);
  const cur = jobs.get(role);
  if (cur && (cur.phase === "replacing" || cur.phase === "loading")) throw new DuoDeployError("A deployment is still running", 409);
  await restorePrevious(role);
  jobs.delete(role);
}

export type DuoRoleStatus = DuoRoleCurrent & { label: string; served: string; answering: boolean; hasPrevious: boolean; job: DuoDeployJob | null };

/** Both roles: what runs, whether it answers, whether there is a previous container, and the last deployment. */
export async function duoPairStatus(): Promise<{ docker: boolean; roles: Record<DuoRole, DuoRoleStatus> }> {
  const docker = dockerAvailable();
  const one = async (role: DuoRole): Promise<DuoRoleStatus> => {
    const s = DUO_ROLES[role];
    const [cur, prev, answering] = docker
      ? await Promise.all([dockerInspect(s.container), dockerInspect(`${s.container}-prev`), serving(role)])
      : [null, null, await serving(role)];
    return {
      ...readCurrent(cur && cur.status === 200 ? cur.json : null),
      label: s.label,
      served: s.served,
      answering,
      hasPrevious: prev?.status === 200,
      job: jobs.get(role) ?? null,
    };
  };
  const [s1, s2] = await Promise.all([one("s1"), one("s2")]);
  return { docker, roles: { s1, s2 } };
}
