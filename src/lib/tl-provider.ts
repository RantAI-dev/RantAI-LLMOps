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
import { TL_ROOT } from "@/lib/models-catalog";
import { inferenceHeaders } from "@/lib/inference";

/**
 * Resolve a usable compute provider id (prefer the `local` one). Resolved at
 * runtime so we never hard-code an id that differs per install.
 */
export async function getComputeProviderId(): Promise<string> {
  const res = await fetch(`${TL_ROOT}/compute_provider/providers/`, {
    headers: inferenceHeaders(),
  });
  if (!res.ok) throw new Error(`Could not list compute providers (${res.status})`);
  const data = (await res.json().catch(() => [])) as
    | Array<Record<string, unknown>>
    | { data?: Array<Record<string, unknown>> };
  const items = Array.isArray(data) ? data : (data.data ?? []);
  const isLocal = (p: Record<string, unknown>) =>
    (p.type ?? p.provider_type) === "local" ||
    String(p.provider_name ?? "").toLowerCase() === "local";
  const chosen = items.find(isLocal) ?? items[0];
  const id = chosen?.id as string | undefined;
  if (!id) throw new Error("No compute provider is available to run jobs");
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
  };
  const res = await fetch(`${TL_ROOT}/compute_provider/providers/${providerId}/launch/`, {
    method: "POST",
    headers: inferenceHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(detail || `Failed to launch job (${res.status})`);
  }
  const data = (await res.json().catch(() => ({}))) as { job_id?: string; message?: string };
  if (!data.job_id) throw new Error(data.message || "Launch accepted but returned no job id");
  return String(data.job_id);
}
