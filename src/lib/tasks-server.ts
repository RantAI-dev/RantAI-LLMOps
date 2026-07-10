/**
 * Server-only helpers for the Tasks page (`/api/tasks/*`).
 *
 * A "task run" in our UI = a Transformer Lab job. TL runs train / eval / export
 * jobs inside an experiment; we list them all from `/jobs/list` and normalize
 * across types so the Tasks monitor can show one row per job with its real
 * status, progress, model, and timing. Job logs come from `/jobs/{id}/output`.
 */
import { inferenceHeaders, TL_ROOT } from "@/lib/inference";
import { tlFetch, unwrapList } from "@/lib/tl-fetch";
import { FINETUNE_EXPERIMENT, NOTE_PREFIX } from "@/lib/tl-constants";
import { readJobLog, saveJobLog } from "@/lib/job-log-store";

const EXPERIMENT = FINETUNE_EXPERIMENT;

export type TlJobRow = {
  id: string;
  experimentId: string; // the TL experiment this job lives under
  type: string; // TRAIN | EVAL | EXPORT | ...
  status: string; // raw TL status
  progress: number;
  model: string;
  template: string;
  startTime: string;
  endTime: string;
  score: number | null; // eval headline accuracy, when present
  // Real launch config (present on our fine-tune jobs), surfaced so the Tasks
  // drawer shows genuine values instead of placeholder zeros.
  subtype: string; // TRAIN | EVAL | EXPORT (job_data.subtype)
  run: string; // the trainer command, e.g. "python unsloth-grpo-train/train.py"
  dataset: string;
  epochs: number;
  batchSize: number;
  learningRate: number;
  maxSteps: number;
  loraR: number;
  loraAlpha: number;
  owner: string;
  // Real output paths TL records for a finished job.
  models: string[]; // trained model / adapter dirs
  artifacts: string[]; // summary/config files
  checkpoint: string; // latest checkpoint dir
};

type TlUserInfo = { name?: string; email?: string };
type TlJob = {
  id?: number | string;
  type?: string;
  status?: string;
  progress?: number;
  job_data?: {
    task_name?: string;
    template_name?: string;
    output_model_name?: string;
    output_model_id?: string;
    model_name?: string;
    input_model_id?: string;
    start_time?: string;
    end_time?: string;
    score?: string;
    subtype?: string;
    run?: string;
    dataset?: string;
    num_train_epochs?: number;
    batch_size?: number;
    learning_rate?: number;
    max_steps?: number;
    lora_r?: number;
    lora_alpha?: number;
    user_info?: TlUserInfo;
    models?: unknown;
    artifacts?: unknown;
    latest_checkpoint?: string;
  };
};

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Coerce a TL path list (may be a string or array) into a clean string[]. */
function strList(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string" && x.length > 0);
  return typeof v === "string" && v.length > 0 ? [v] : [];
}

/** Headline accuracy from an eval job's `score` JSON (`[{type,score}]`). */
function headlineScore(raw?: string): number | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw) as Array<{ type: string; score: number }>;
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const acc = arr.find((s) => s.type?.toLowerCase() === "acc");
    return (acc ?? arr[0]).score;
  } catch {
    return null;
  }
}

function normalize(j: TlJob, experimentId: string): TlJobRow {
  const d = j.job_data ?? {};
  return {
    id: String(j.id ?? ""),
    experimentId,
    type: j.type ?? "TASK",
    status: j.status ?? "UNKNOWN",
    progress: typeof j.progress === "number" ? j.progress : 0,
    model: d.model_name ?? d.input_model_id ?? d.output_model_id ?? "—",
    // The user-chosen adaptor name (`task_name`) is the distinctive per-job label
    // — prefer it. `template_name` is the shared trainer template ("unsloth-demo",
    // same for every run) and only a fallback. Last resort: short id, never a
    // raw "REMOTE {uuid}".
    template:
      d.task_name ??
      d.template_name ??
      d.output_model_name ??
      `Job ${String(j.id ?? "").slice(0, 8)}`,
    startTime: d.start_time ?? "",
    endTime: d.end_time ?? "",
    score: headlineScore(d.score),
    subtype: d.subtype ?? "",
    run: d.run ?? "",
    dataset: d.dataset ?? "",
    epochs: num(d.num_train_epochs),
    batchSize: num(d.batch_size),
    learningRate: num(d.learning_rate),
    maxSteps: num(d.max_steps),
    loraR: num(d.lora_r),
    loraAlpha: num(d.lora_alpha),
    owner: d.user_info?.name ?? d.user_info?.email ?? "",
    models: strList(d.models),
    artifacts: strList(d.artifacts),
    checkpoint: d.latest_checkpoint ?? "",
  };
}

/** Jobs for one experiment, tagged with its id. No `slim` — it strips `job_data`
 * (including `task_name`) which we need for the distinctive task label. */
async function listJobsForExperiment(experimentId: string): Promise<TlJobRow[]> {
  try {
    const res = await tlFetch(`/experiment/${encodeURIComponent(experimentId)}/jobs/list`);
    if (!res.ok) return [];
    const rows = unwrapList<TlJob>(await res.json().catch(() => []));
    return rows.map((j) => normalize(j, experimentId));
  } catch {
    return [];
  }
}

/**
 * Every experiment id, including the default, tolerant of a failed list call —
 * so a transient `/experiment/` list error still yields the default experiment
 * instead of throwing. The single source for all cross-experiment fan-outs.
 */
export async function allExperimentIds(): Promise<string[]> {
  const experiments = await listTlExperiments().catch(() => []);
  // Note experiments (`note-*`) hold Notes markdown, never jobs — skip them so
  // the per-experiment job fan-out doesn't waste a request on each note.
  const ids = experiments.map((e) => e.id).filter((id) => !id.startsWith(NOTE_PREFIX));
  return [...new Set([EXPERIMENT, ...ids])];
}

/**
 * All jobs across EVERY experiment, newest first. TL scopes jobs per experiment
 * (`/experiment/{id}/jobs/list`) with no global endpoint, so we fan out over the
 * experiment list and merge. Sorted by start time desc; not-yet-started jobs
 * (empty startTime) sort to the top as the newest.
 */
export async function listAllJobs(): Promise<TlJobRow[]> {
  const ids = await allExperimentIds();
  const perExperiment = await Promise.all(ids.map(listJobsForExperiment));
  return perExperiment
    .flat()
    .sort((a, b) => (b.startTime || "9999").localeCompare(a.startTime || "9999"));
}

/**
 * Which experiment a job lives under. TL scopes per-job ops per experiment, so
 * acting on a job that was launched into a non-default experiment needs this. We
 * check every experiment in parallel (slim listing) and fall back to the default.
 * NOTE: if a job's real experiment list-call fails transiently, no match is found
 * and the op targets the default — which then 404s. Callers treat that as a
 * retriable failure (stop/delete return false), not a crash.
 */
export async function resolveJobExperiment(jobId: string): Promise<string> {
  const ids = await allExperimentIds();
  const matches = await Promise.all(
    ids.map(async (id) => {
      try {
        const res = await tlFetch(`/experiment/${encodeURIComponent(id)}/jobs/list?slim=true`);
        if (!res.ok) return null;
        const rows = unwrapList<{ id?: string | number }>(await res.json().catch(() => []));
        return rows.some((j) => String(j.id ?? "") === jobId) ? id : null;
      } catch {
        return null;
      }
    })
  );
  return matches.find((m): m is string => m != null) ?? EXPERIMENT;
}

/** SDK output for a job (`/jobs/{id}/output`) — the `lab.log()` summary. */
async function fetchSdkOutput(id: string, experiment: string): Promise<string> {
  const res = await fetch(
    `${TL_ROOT}/experiment/${encodeURIComponent(experiment)}/jobs/${encodeURIComponent(id)}/output`,
    { headers: inferenceHeaders() }
  );
  if (!res.ok) return "";
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const parsed = await res.json().catch(() => null);
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed === "object") {
      const o = parsed as { output?: string; logs?: string };
      return o.output ?? o.logs ?? "";
    }
    return "";
  }
  return res.text().catch(() => "");
}

/** Live provider console for a job (`/jobs/{id}/provider_logs`) — raw stdout
 *  (loss curves, progress, errors). This is what updates while a job RUNs. */
async function fetchProviderConsole(id: string, experiment: string): Promise<string> {
  try {
    const res = await fetch(
      `${TL_ROOT}/experiment/${encodeURIComponent(experiment)}/jobs/${encodeURIComponent(id)}/provider_logs?tail_lines=2000`,
      { headers: inferenceHeaders() }
    );
    if (!res.ok) return "";
    const data = (await res.json().catch(() => ({}))) as { logs?: string };
    return typeof data?.logs === "string" ? data.logs : "";
  } catch {
    return "";
  }
}

/**
 * Logs for one job. v0.40.0 jobs run via a compute provider, so the live console
 * (training loss, progress, errors) is in `provider_logs`; the SDK `/output` has
 * the `lab.log()` summary. We show the console when present (it's the most useful
 * while a job runs), falling back to the SDK output.
 */
export async function jobOutput(id: string, experimentId?: string): Promise<string> {
  // The drawer polls this every ~3s while a job runs and already knows the job's
  // experiment, so it passes it through to skip the fan-out resolver on the hot
  // path. Fall back to resolving only when the caller doesn't supply it.
  const experiment = experimentId?.trim() || (await resolveJobExperiment(id));
  const [console_, sdk] = await Promise.all([
    fetchProviderConsole(id, experiment),
    fetchSdkOutput(id, experiment),
  ]);
  const live = console_.trim()
    ? sdk.trim()
      ? `${console_}\n\n— — — — —\n${sdk}`
      : console_
    : sdk;

  // TL purges provider_logs after a run, so a finished job's log + loss curve
  // would go blank. While the live provider console is present (job running),
  // snapshot the freshest tail and serve it; once purged, serve the last
  // snapshot (falling back to the SDK summary / raw text if none was captured).
  const consoleReal = console_.trim().length > 0 && !/no log files? found/i.test(console_);
  if (consoleReal) {
    await saveJobLog(id, live);
    return live;
  }
  const persisted = await readJobLog(id);
  return persisted.trim() ? persisted : live;
}

/** Ask a running job to stop (`GET /jobs/{id}/stop`). Returns whether TL accepted it. */
export async function stopJob(id: string): Promise<boolean> {
  try {
    const experiment = await resolveJobExperiment(id);
    const res = await fetch(
      `${TL_ROOT}/experiment/${encodeURIComponent(experiment)}/jobs/${encodeURIComponent(id)}/stop`,
      { headers: inferenceHeaders() }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Delete a job record (`DELETE /jobs/{id}`). Returns whether TL accepted it. */
export async function deleteJob(id: string): Promise<boolean> {
  try {
    const experiment = await resolveJobExperiment(id);
    const res = await fetch(
      `${TL_ROOT}/experiment/${encodeURIComponent(experiment)}/jobs/${encodeURIComponent(id)}`,
      { method: "DELETE", headers: inferenceHeaders() }
    );
    return res.ok;
  } catch {
    return false;
  }
}

export type TlExperimentRow = { id: string; name: string };

/** Real experiments (`GET /experiment/`). */
export async function listTlExperiments(): Promise<TlExperimentRow[]> {
  const res = await tlFetch(`/experiment/`);
  if (!res.ok) throw new Error(`experiments ${res.status}`);
  const rows = unwrapList<{ id?: string | number; name?: string }>(
    await res.json().catch(() => [])
  );
  return rows
    .filter((e) => e.id != null)
    .map((e) => ({ id: String(e.id), name: e.name ?? String(e.id) }));
}

/**
 * Create an experiment (`GET /experiment/create?name=`). TL uses the (secured)
 * name as the id. Returns the new id, or throws with TL's message.
 */
export async function createTlExperiment(name: string): Promise<string> {
  const res = await fetch(`${TL_ROOT}/experiment/create?name=${encodeURIComponent(name)}`, {
    headers: inferenceHeaders(),
  });
  if (res.ok) {
    const id = await res.json().catch(() => name);
    return typeof id === "string" ? id : name;
  }
  if (res.status === 409) return name; // already exists — fine
  const detail = await res.text().catch(() => "");
  throw new Error(detail || `Gagal membuat experiment (${res.status})`);
}

/** Delete an experiment (`GET /experiment/{id}/delete`). Returns whether TL accepted it. */
export async function deleteTlExperiment(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${TL_ROOT}/experiment/${encodeURIComponent(id)}/delete`, {
      headers: inferenceHeaders(),
    });
    return res.ok;
  } catch {
    return false;
  }
}
