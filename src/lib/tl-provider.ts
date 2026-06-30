/**
 * Server-only helpers for Transformer Lab's v0.40.0 compute-provider execution
 * layer. In v0.40.0 ALL execution (train, eval, export, interactive) goes
 * through a compute provider — even local runs use a built-in "local" provider
 * that clones a GitHub-hosted task, builds a uv venv from `setup`, and runs it.
 *
 * Shared by the fine-tune and eval features so the launch contract lives in one
 * place. The launch is self-contained: the full task spec (run/setup/repo/
 * parameters) is passed in the launch body; no separate task/create is needed.
 */
import { tlFetch, unwrapList } from "@/lib/tl-fetch";
import { redactSecrets } from "@/lib/redact";

/**
 * Resolve a usable compute provider id (prefer the `local` one). Resolved at
 * runtime so we never hard-code an id that differs per install.
 */
export async function getComputeProviderId(): Promise<string> {
  const res = await tlFetch(`/compute_provider/providers/`);
  if (!res.ok) throw new Error(`Could not list compute providers (${res.status})`);
  const items = unwrapList<Record<string, unknown>>(await res.json().catch(() => []));
  const isLocal = (p: Record<string, unknown>) =>
    (p.type ?? p.provider_type) === "local" ||
    String(p.provider_name ?? "").toLowerCase() === "local";
  const isDisabled = (p: Record<string, unknown>) => p.disabled === true || p.is_disabled === true;

  // Prefer an enabled local provider. If there's no local one, only fall back to
  // a single enabled provider — never silently pick `items[0]` out of several,
  // which could route a local-intended (free) job to a remote/billable one.
  const enabled = items.filter((p) => !isDisabled(p));
  const chosen = enabled.find(isLocal) ?? (enabled.length === 1 ? enabled[0] : undefined);
  const id = chosen?.id as string | undefined;
  if (!id) {
    throw new Error(
      "No local compute provider available. Configure a 'local' provider in Transformer Lab " +
        "(or disable the extra remote providers so the choice is unambiguous)."
    );
  }
  return id;
}

export type ProviderLaunchSpec = {
  experimentId: string;
  taskName: string;
  /** Command run on the (local) cluster, e.g. "python trainer/train.py". */
  run: string;
  /** Shell that builds the job's uv venv, e.g. "uv pip install ...". */
  setup: string;
  githubRepoUrl: string;
  githubRepoDir: string;
  /** SkyPilot-style accelerator spec, e.g. "NVIDIA:1". */
  accelerators?: string;
  /** Hyperparameters/config surfaced to the task via `lab.get_config()`. */
  parameters: Record<string, unknown>;
  envVars?: Record<string, string>;
  minutesRequested?: number;
  description?: string;
  /**
   * Logical kind of work ("TRAIN" | "EVAL") for filtering. All provider jobs are
   * type=REMOTE at the TL layer, so we tag them with a subtype to tell training
   * runs from evals when listing.
   */
  subtype?: string;
};

/**
 * Launch a GitHub-hosted task on the local compute provider and return the
 * REMOTE job id. Poll it via `/experiment/{id}/jobs/{jobId}`.
 */
export async function launchProviderTask(spec: ProviderLaunchSpec): Promise<string> {
  const providerId = await getComputeProviderId();
  const body = {
    experiment_id: spec.experimentId,
    task_name: spec.taskName,
    run: spec.run,
    setup: spec.setup,
    github_repo_url: spec.githubRepoUrl,
    github_repo_dir: spec.githubRepoDir,
    accelerators: spec.accelerators ?? "NVIDIA:1",
    parameters: spec.parameters,
    env_vars: spec.envVars ?? { PYTHONUNBUFFERED: "1" },
    minutes_requested: spec.minutesRequested ?? 120,
    description: spec.description,
    subtype: spec.subtype,
  };
  const res = await tlFetch(`/compute_provider/providers/${providerId}/launch/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 60_000,
  });
  if (!res.ok) {
    // TL may reflect submitted env vars (incl. an HF token) in its error body.
    const detail = redactSecrets(await res.text().catch(() => ""), Object.values(spec.envVars ?? {}));
    throw new Error(detail || `Failed to launch job (${res.status})`);
  }
  const data = (await res.json().catch(() => ({}))) as { job_id?: string; message?: string };
  if (!data.job_id) throw new Error(data.message || "Launch accepted but returned no job id");
  return String(data.job_id);
}
