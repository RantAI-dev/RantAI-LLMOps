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
import { FINETUNE_EXPERIMENT } from "@/lib/tl-constants";

const EXPERIMENT = FINETUNE_EXPERIMENT;

export type TlJobRow = {
  id: string;
  type: string; // TRAIN | EVAL | EXPORT | ...
  status: string; // raw TL status
  progress: number;
  model: string;
  template: string;
  startTime: string;
  endTime: string;
  score: number | null; // eval headline accuracy, when present
};

type TlJob = {
  id?: number | string;
  type?: string;
  status?: string;
  progress?: number;
  job_data?: {
    template_name?: string;
    output_model_name?: string;
    output_model_id?: string;
    model_name?: string;
    input_model_id?: string;
    start_time?: string;
    end_time?: string;
    score?: string;
  };
};

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

function normalize(j: TlJob): TlJobRow {
  const d = j.job_data ?? {};
  return {
    id: String(j.id ?? ""),
    type: j.type ?? "TASK",
    status: j.status ?? "UNKNOWN",
    progress: typeof j.progress === "number" ? j.progress : 0,
    model: d.model_name ?? d.input_model_id ?? d.output_model_id ?? "—",
    template: d.template_name ?? d.output_model_name ?? `${j.type ?? "Job"} ${j.id}`,
    startTime: d.start_time ?? "",
    endTime: d.end_time ?? "",
    score: headlineScore(d.score),
  };
}

/** All jobs in the working experiment, newest first. (v0.40.0: experiment-scoped.) */
export async function listAllJobs(): Promise<TlJobRow[]> {
  const res = await tlFetch(`/experiment/${EXPERIMENT}/jobs/list?slim=true`);
  if (!res.ok) throw new Error(`jobs ${res.status}`);
  const rows = unwrapList<TlJob>(await res.json().catch(() => []));
  return rows.map(normalize).reverse();
}

/** SDK output for a job (`/jobs/{id}/output`) — the `lab.log()` summary. */
async function fetchSdkOutput(id: string): Promise<string> {
  const res = await fetch(
    `${TL_ROOT}/experiment/${EXPERIMENT}/jobs/${encodeURIComponent(id)}/output`,
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
async function fetchProviderConsole(id: string): Promise<string> {
  try {
    const res = await fetch(
      `${TL_ROOT}/experiment/${EXPERIMENT}/jobs/${encodeURIComponent(id)}/provider_logs?tail_lines=500`,
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
export async function jobOutput(id: string): Promise<string> {
  const [console_, sdk] = await Promise.all([fetchProviderConsole(id), fetchSdkOutput(id)]);
  if (console_.trim()) {
    return sdk.trim() ? `${console_}\n\n— — — — —\n${sdk}` : console_;
  }
  return sdk;
}

/** Ask a running job to stop (`GET /jobs/{id}/stop`). Returns whether TL accepted it. */
export async function stopJob(id: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${TL_ROOT}/experiment/${EXPERIMENT}/jobs/${encodeURIComponent(id)}/stop`,
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
    const res = await fetch(
      `${TL_ROOT}/experiment/${EXPERIMENT}/jobs/${encodeURIComponent(id)}`,
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
