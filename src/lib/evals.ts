/**
 * Server-only helpers for the Evals feature (`/api/evals/*`).
 *
 * Runs the EleutherAI LM-Evaluation-Harness on a model via Transformer Lab —
 * the same task/job machinery as fine-tuning. Flow: point the experiment's
 * foundation at the model → create an EVAL task → queue it → poll the job. The
 * benchmark accuracy lands in `job_data.score`.
 *
 * Only safetensors models can be evaluated (the harness loads via HF
 * transformers); GGUF is inference-only.
 */
import { fetchDownloaded, TL_ROOT, type CatalogModel } from "@/lib/models-catalog";
import { inferenceHeaders } from "@/lib/inference";

const EVAL_EXPERIMENT = "nqr-ft";
const EVAL_PLUGIN = "eleuther-ai-lm-evaluation-harness";

export type Benchmark = { id: string; name: string; description: string };

/** Small, well-known multiple-choice benchmarks that run quickly on a small GPU. */
export const BENCHMARKS: Benchmark[] = [
  { id: "arc_easy", name: "ARC Easy", description: "Grade-school science questions (easy)." },
  { id: "arc_challenge", name: "ARC Challenge", description: "Harder grade-school science." },
  { id: "hellaswag", name: "HellaSwag", description: "Commonsense sentence completion." },
  { id: "piqa", name: "PIQA", description: "Physical commonsense reasoning." },
  { id: "winogrande", name: "WinoGrande", description: "Pronoun/coreference resolution." },
  { id: "boolq", name: "BoolQ", description: "Yes/no reading comprehension." },
];

export type EvalModel = {
  id: string;
  name: string;
  /** Local path for fused/fine-tuned models; empty for HF-hub models. */
  localPath?: string;
  architecture: string;
  /** True for our own fine-tuned (fused) models. */
  fineTuned: boolean;
};

export type EvalOptions = { models: EvalModel[]; benchmarks: Benchmark[] };

export type EvalScore = { type: string; score: number };

export type EvalJob = {
  id: string;
  name: string;
  model?: string;
  benchmark?: string;
  status: string;
  progress: number;
  scores: EvalScore[];
};

/** Evaluable models = downloaded safetensors (base + our fused fine-tunes). */
export async function fetchEvalOptions(): Promise<EvalOptions> {
  const downloaded = await fetchDownloaded();
  const models: EvalModel[] = downloaded
    .filter((m: CatalogModel) => !m.isGguf)
    .map((m) => ({
      id: m.id,
      name: m.id.startsWith("TransformerLab/") ? m.id.slice("TransformerLab/".length) : m.name,
      localPath: m.localPath,
      architecture: m.architecture,
      fineTuned: m.id.startsWith("TransformerLab/"),
    }));
  return { models, benchmarks: BENCHMARKS };
}

export type SubmitEvalParams = {
  model: string;
  modelArchitecture?: string;
  benchmark: string;
  /** Fraction of the benchmark to run, 0–1 (smaller = faster). */
  limit?: number;
};

/**
 * Run a benchmark on a model. Sets the experiment foundation, creates an EVAL
 * task and queues it. Returns the TL job id; poll `/api/evals/jobs`.
 */
export async function submitEval(p: SubmitEvalParams): Promise<string> {
  // Resolve the model's local path (fused models have one; HF-hub models don't).
  const downloaded = await fetchDownloaded();
  const model = downloaded.find((m) => m.id === p.model);
  const localPath = model?.localPath ?? "";
  const architecture = p.modelArchitecture ?? model?.architecture ?? "";

  // Point the experiment's foundation at the model (the harness reads it).
  await fetch(`${TL_ROOT}/experiment/${EVAL_EXPERIMENT}/update_configs`, {
    method: "POST",
    headers: inferenceHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      foundation: p.model,
      foundation_filename: localPath,
      foundation_model_architecture: architecture,
    }),
  });

  const name = `eval-${slug(p.model)}-${p.benchmark}`;
  const task = {
    name,
    type: "EVAL",
    plugin: EVAL_PLUGIN,
    experiment_id: EVAL_EXPERIMENT,
    inputs: { model_name: p.model, model_architecture: architecture },
    outputs: {},
    config: {
      plugin_name: EVAL_PLUGIN,
      script_parameters: {
        tasks: p.benchmark,
        limit: p.limit ?? 0.05,
        model_name: p.model,
      },
    },
  };

  await fetch(`${TL_ROOT}/tasks/new_task`, {
    method: "PUT",
    headers: inferenceHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(task),
  });

  // Find + queue it.
  const listRes = await fetch(`${TL_ROOT}/tasks/list_by_type?type=EVAL`, {
    headers: inferenceHeaders(),
  });
  const tasks = (await listRes.json().catch(() => [])) as Array<{ id?: string; name?: string }>;
  const created = (Array.isArray(tasks) ? tasks : []).find((t) => t.name === name);
  if (!created?.id) throw new Error("Eval task was created but could not be found to queue");

  const queued = await fetch(`${TL_ROOT}/tasks/${created.id}/queue`, { headers: inferenceHeaders() });
  const qData = (await queued.json().catch(() => ({}))) as { id?: number; detail?: string };
  if (!queued.ok || qData.id == null) {
    throw new Error(qData.detail || `Failed to queue eval (${queued.status})`);
  }
  return String(qData.id);
}

type TlEvalJob = {
  id?: number | string;
  status?: string;
  progress?: number;
  job_data?: {
    template_name?: string;
    model_name?: string;
    score?: string;
    config?: { script_parameters?: { tasks?: string } };
  };
};

function parseScores(raw?: string): EvalScore[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as EvalScore[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function normalize(j: TlEvalJob): EvalJob {
  return {
    id: String(j.id ?? ""),
    name: j.job_data?.template_name ?? `Eval ${j.id}`,
    model: j.job_data?.model_name,
    benchmark: j.job_data?.config?.script_parameters?.tasks,
    status: j.status ?? "UNKNOWN",
    progress: typeof j.progress === "number" ? j.progress : 0,
    scores: parseScores(j.job_data?.score),
  };
}

/** All eval jobs in the experiment, newest first. */
export async function fetchEvalJobs(): Promise<EvalJob[]> {
  try {
    const res = await fetch(`${TL_ROOT}/jobs/list?experimentId=${EVAL_EXPERIMENT}&type=EVAL`, {
      headers: inferenceHeaders(),
    });
    const rows = (await res.json().catch(() => [])) as TlEvalJob[];
    return (Array.isArray(rows) ? rows : []).map(normalize).reverse();
  } catch {
    return [];
  }
}

function slug(s: string): string {
  return (s.split("/").pop() ?? s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
