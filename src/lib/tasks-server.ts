/**
 * Server-only helpers for the Tasks page (`/api/tasks/*`).
 *
 * A "task run" in our UI = a Transformer Lab job. TL runs train / eval / export
 * jobs inside an experiment; we list them all from `/jobs/list` and normalize
 * across types so the Tasks monitor can show one row per job with its real
 * status, progress, model, and timing. Job logs come from `/jobs/{id}/output`.
 */
import { inferenceHeaders } from "@/lib/inference";
import { TL_ROOT } from "@/lib/models-catalog";

const EXPERIMENT = "nqr-ft";

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
  const res = await fetch(`${TL_ROOT}/experiment/${EXPERIMENT}/jobs/list?slim=true`, {
    headers: inferenceHeaders(),
  });
  if (!res.ok) throw new Error(`jobs ${res.status}`);
  const rows = (await res.json().catch(() => [])) as TlJob[];
  return (Array.isArray(rows) ? rows : []).map(normalize).reverse();
}

/**
 * Raw stdout/log for one job (`/jobs/{id}/output`). TL returns the whole log as
 * a JSON-encoded string (not an object), so handle a bare string as well as the
 * `{output}` / `{logs}` object shapes.
 */
export async function jobOutput(id: string): Promise<string> {
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

export type TlExperimentRow = { id: string; name: string };

/** Real experiments (`GET /experiment/`). */
export async function listTlExperiments(): Promise<TlExperimentRow[]> {
  const res = await fetch(`${TL_ROOT}/experiment/`, { headers: inferenceHeaders() });
  if (!res.ok) throw new Error(`experiments ${res.status}`);
  const rows = (await res.json().catch(() => [])) as Array<{ id?: string | number; name?: string }>;
  return (Array.isArray(rows) ? rows : [])
    .filter((e) => e.id != null)
    .map((e) => ({ id: String(e.id), name: e.name ?? String(e.id) }));
}
