/**
 * Server-only helpers for the Evals feature (`/api/evals/*`).
 *
 * Runs the EleutherAI LM-Evaluation-Harness on a model via Transformer Lab.
 * v0.40.0: launch the GitHub-hosted harness task on the local compute provider
 * (it pulls the model from Hugging Face by id, runs lm-eval, then saves the
 * metrics as `evals` artifacts) → poll the resulting REMOTE job. Scores are read
 * from the eval artifacts / `/evals/compare_evals`, NOT `job_data.score`.
 *
 * Only safetensors models can be evaluated (the harness loads via HF
 * transformers); GGUF is inference-only.
 */
import { fetchDownloaded, TL_ROOT, type CatalogModel } from "@/lib/models-catalog";
import { inferenceHeaders } from "@/lib/inference";
import { launchProviderTask } from "@/lib/tl-provider";

const EVAL_EXPERIMENT = "nqr-ft";

/** GitHub-hosted EleutherAI lm-eval harness trainer (mirrors its task.yaml). */
const EVAL_GITHUB_URL = "https://github.com/transformerlab/transformerlab-app";
const EVAL_GITHUB_DIR = "api/transformerlab/galleries/examples/eleutherai-lm-evaluation-harness";
const EVAL_SETUP = "uv pip install lm_eval==0.4.7 pandas torch";
const EVAL_RUN = "python eleutherai-lm-evaluation-harness/train.py";

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
  /** HF-resolvable model id (e.g. "HuggingFaceTB/SmolLM-135M-Instruct"). */
  model: string;
  modelArchitecture?: string;
  benchmark: string;
  /** Fraction of the benchmark to run, 0–1 (smaller = faster). */
  limit?: number;
  /** Optional local path (for a fused/fine-tuned model) and adapter dir. */
  modelPath?: string;
  modelAdapter?: string;
  hfToken?: string;
};

/**
 * Run a benchmark on a model by launching the lm-eval harness on the local
 * compute provider. Returns the REMOTE job id; poll `/api/evals/jobs`. The
 * harness pulls the model from Hugging Face by id (or uses `modelPath` for a
 * local model) and writes metrics as `evals` artifacts.
 */
export async function submitEval(p: SubmitEvalParams): Promise<string> {
  const name = `eval-${slug(p.model)}-${p.benchmark}`;
  const env_vars: Record<string, string> = { PYTHONUNBUFFERED: "1" };
  if (p.hfToken) env_vars.HF_TOKEN = p.hfToken;

  return launchProviderTask({
    experimentId: EVAL_EXPERIMENT,
    taskName: name,
    run: EVAL_RUN,
    setup: EVAL_SETUP,
    githubRepoUrl: EVAL_GITHUB_URL,
    githubRepoDir: EVAL_GITHUB_DIR,
    accelerators: "NVIDIA:1",
    // Maps onto the harness trainer's `lab.get_config()` keys. `limit` is a
    // string in the trainer (it float-parses it); 1.0 means "no limit".
    parameters: {
      model_name: p.model,
      model_path: p.modelPath ?? "",
      model_adapter: p.modelAdapter ?? "",
      tasks: p.benchmark,
      limit: String(p.limit ?? 0.05),
    },
    envVars: env_vars,
    description: `Eval ${p.model} on ${p.benchmark}`,
    subtype: "EVAL",
  });
}

/** Harness dir basename — used to recognise our EVAL jobs (all are type=REMOTE). */
const EVAL_DIR_TAG = "eleutherai-lm-evaluation-harness";

/** A job is one of our evals if it ran the harness (or is tagged EVAL). */
function isEvalJob(j: TlEvalJob): boolean {
  const d = j.job_data ?? {};
  if (d.subtype === "EVAL") return true;
  return typeof d.run === "string" && d.run.includes(EVAL_DIR_TAG);
}

type TlEvalJob = {
  id?: number | string;
  status?: string;
  progress?: number;
  job_data?: {
    // v0.30.3 plugin jobs
    template_name?: string;
    model_name?: string;
    score?: string;
    config?: { script_parameters?: { tasks?: string } };
    // v0.40.0 provider (REMOTE) jobs
    task_name?: string;
    parameters?: { model_name?: string; tasks?: string };
    launch_progress?: { percent?: number };
    subtype?: string;
    run?: string;
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
  const d = j.job_data ?? {};
  const progress =
    typeof j.progress === "number" && j.progress > 0
      ? j.progress
      : typeof d.launch_progress?.percent === "number"
        ? d.launch_progress.percent
        : 0;
  return {
    id: String(j.id ?? ""),
    name: d.task_name ?? d.template_name ?? `Eval ${j.id}`,
    model: d.parameters?.model_name ?? d.model_name,
    benchmark: d.parameters?.tasks ?? d.config?.script_parameters?.tasks,
    status: j.status ?? "UNKNOWN",
    progress,
    // v0.40.0 eval scores live in `evals` artifacts / /evals/compare_evals, not
    // job_data.score. Kept as a fallback for any legacy plugin jobs.
    scores: parseScores(d.score),
  };
}

type LmEvalResults = { results?: Record<string, Record<string, number | string>> };

/**
 * Read a finished eval job's accuracy scores. v0.40.0 stores them as the raw
 * lm-eval results JSON (not `job_data.score`), exposed via `get_eval_results`.
 * We keep the primary accuracy metrics (`acc`, `acc_norm`) and drop stderr.
 */
async function fetchEvalScores(jobId: string): Promise<EvalScore[]> {
  try {
    const res = await fetch(
      `${TL_ROOT}/experiment/${EVAL_EXPERIMENT}/jobs/${encodeURIComponent(jobId)}/get_eval_results?experimentId=${EVAL_EXPERIMENT}&task=view`,
      { headers: inferenceHeaders() }
    );
    if (!res.ok) return [];
    // The endpoint returns text/csv ("No evaluation results found") when empty.
    if (!(res.headers.get("content-type") ?? "").includes("application/json")) return [];
    const data = (await res.json()) as LmEvalResults;
    const out: EvalScore[] = [];
    for (const taskRes of Object.values(data.results ?? {})) {
      for (const [key, value] of Object.entries(taskRes)) {
        if (typeof value === "number" && key.includes("acc") && !key.includes("stderr")) {
          out.push({ type: key.split(",")[0], score: value }); // "acc,none" -> "acc"
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * All eval jobs in the experiment, newest first, with scores for finished ones.
 * v0.40.0 provider jobs are all type=REMOTE, so we list everything (no `slim` —
 * it strips the job_data we classify on) and keep the ones that ran the harness.
 */
export async function fetchEvalJobs(): Promise<EvalJob[]> {
  try {
    const res = await fetch(
      `${TL_ROOT}/experiment/${EVAL_EXPERIMENT}/jobs/list`,
      { headers: inferenceHeaders() }
    );
    const raw = (await res.json().catch(() => [])) as TlEvalJob[] | { data?: TlEvalJob[] };
    const rows = Array.isArray(raw) ? raw : (raw.data ?? []);
    const jobs = rows.filter(isEvalJob).map(normalize).reverse();
    // Scores live in a per-job artifact, not the list payload — fetch them for
    // finished jobs (eval jobs are few, so the extra calls are cheap).
    await Promise.all(
      jobs.map(async (j) => {
        if (j.status === "COMPLETE" && j.scores.length === 0) {
          j.scores = await fetchEvalScores(j.id);
        }
      })
    );
    return jobs;
  } catch {
    return [];
  }
}

function slug(s: string): string {
  return (s.split("/").pop() ?? s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
