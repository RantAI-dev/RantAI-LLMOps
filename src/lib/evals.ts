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
import { BENCHMARKS, benchmarkById, type Benchmark } from "@/lib/benchmarks";
import { runHostScript } from "@/lib/host-runner";
import { fetchDownloaded, TL_ROOT, type CatalogModel } from "@/lib/models-catalog";
import { inferenceHeaders } from "@/lib/inference";
import { launchProviderTask } from "@/lib/tl-provider";
import { RECOMMENDED_MODELS, fetchFineTuned } from "@/lib/finetune";
import { assertJobId, assertModelId, assertTag } from "@/lib/validate";
import { FINETUNE_EXPERIMENT } from "@/lib/tl-constants";
import { allExperimentIds, createTlExperiment, resolveJobExperiment } from "@/lib/tasks-server";
import { tlFetch, unwrapList } from "@/lib/tl-fetch";
import { logServerError } from "@/lib/log";

// Eval jobs run under the same single hidden experiment as fine-tunes (TL
// requires an experiment context; the concept isn't exposed in the UI).
const EVAL_EXPERIMENT = FINETUNE_EXPERIMENT;

/** GitHub-hosted EleutherAI lm-eval harness trainer (mirrors its task.yaml). */
/**
 * The benchmark harness — a RantAI fork in THIS repo under `trainers/`, not the
 * upstream gallery. Upstream built `--model_args` without naming a dtype, so
 * weights loaded as fp16 while Apertus' xIELU activation builds its parameters
 * in bf16; mixing the two promotes to fp32 and the next Linear rejects its own
 * input, killing every Apertus benchmark before the first sample was scored.
 * See trainers/eleutherai-lm-evaluation-harness/train.py.
 *
 * NOTE: Transformer Lab clones the repo's DEFAULT BRANCH, so an edit to the
 * harness only takes effect once it is merged to `main` and pushed.
 */
const EVAL_GITHUB_URL = "https://github.com/RantAI-dev/RantAI-LLMOps";
const EVAL_GITHUB_DIR = "trainers/eleutherai-lm-evaluation-harness";
const EVAL_SETUP = "uv pip install lm_eval==0.4.7 pandas torch";
const EVAL_RUN = "python eleutherai-lm-evaluation-harness/train.py";

// The benchmark catalogue lives in lib/benchmarks.ts (plain data, client-safe);
// re-exported here so existing server-side importers keep one entry point.
// Client components must import it from there directly — pulling a value out of
// THIS module drags host-runner's node:child_process into the browser bundle.
export { BENCHMARKS, benchmarkById, type Benchmark };

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

export type EvalScore = {
  type: string;
  score: number;
  /**
   * Standard error of `score`, as the harness reports it. Carried because a
   * score without it cannot be compared: two runs of the SAME model on ARC Easy
   * scored 79.4% and 78.2%, a gap well inside one stderr. Shown as a difference
   * without this number, that noise reads as a real win for one model.
   */
  stderr?: number;
};

export type EvalJob = {
  id: string;
  name: string;
  model?: string;
  benchmark?: string;
  status: string;
  progress: number;
  scores: EvalScore[];
  /**
   * Fraction of the benchmark the run covered, 0..1. Surfaced because a 5% run
   * and a 100% run produce the same-looking percentage, and putting them side by
   * side is not a comparison — the small one is mostly sampling noise.
   */
  coverage?: number;
  /** Questions actually scored. The denominator behind every rate above. */
  samples?: number;
  /** Weight dtype the harness ran with. */
  dtype?: string;
  /** TL timestamps (UTC, zone-less) — when the run started / finished. */
  startedAt?: string;
  finishedAt?: string;
};

/** Evaluable models = our fine-tunes + downloaded safetensors + recommended HF bases. */
export async function fetchEvalOptions(): Promise<EvalOptions> {
  const [downloaded, fineTunes] = await Promise.all([fetchDownloaded(), fetchFineTuned()]);
  // Fine-tunes (completed train jobs). The id is the TRAIN JOB id — submitEval
  // merges the adapter and evaluates the merged model locally (lm-eval can't
  // load a LoRA adapter from HF).
  const ftModels: EvalModel[] = fineTunes.map((ft) => ({
    id: ft.fusedModelId, // = train job id
    name: ft.name,
    architecture: "",
    fineTuned: true,
  }));
  const localModels: EvalModel[] = downloaded
    .filter((m: CatalogModel) => !m.isGguf)
    .map((m) => ({
      id: m.id,
      name: m.id.startsWith("TransformerLab/") ? m.id.slice("TransformerLab/".length) : m.name,
      localPath: m.localPath,
      architecture: m.architecture,
      fineTuned: m.id.startsWith("TransformerLab/"),
    }));
  // The lm-eval harness pulls the model from HF by id at run time, so on a fresh
  // workspace (no local models) we still offer recommended bases to evaluate.
  const haveIds = new Set(localModels.map((m) => m.id));
  const recommended: EvalModel[] = RECOMMENDED_MODELS.filter((m) => !haveIds.has(m.id)).map(
    (m) => ({ id: m.id, name: m.name, architecture: m.architecture, fineTuned: false })
  );
  return { models: [...ftModels, ...localModels, ...recommended], benchmarks: BENCHMARKS };
}

export type SubmitEvalParams = {
  /**
   * Either an HF model id (e.g. "HuggingFaceTB/SmolLM-135M-Instruct") for a base
   * model, OR — when `fineTuned` is true — the TRAIN job id of a fine-tune.
   */
  model: string;
  modelArchitecture?: string;
  benchmark: string;
  /** Fraction of the benchmark to run, 0–1 (smaller = faster). */
  limit?: number;
  /** Weight dtype for the harness. Defaults to bfloat16: it is what this hardware
   *  and Apertus' xIELU activation both use, and naming one dtype for weights and
   *  activations is what stops the fp32 promotion that failed every Apertus run. */
  dtype?: string;
  /** Optional local path (for a model already on disk) and adapter dir. */
  modelPath?: string;
  modelAdapter?: string;
  hfToken?: string;
  /** When true, `model` is a fine-tune train job id (merge + eval locally). */
  fineTuned?: boolean;
};

/**
 * Run a benchmark on a model by launching the lm-eval harness on the local
 * compute provider. Returns the REMOTE job id; poll `/api/evals/jobs`.
 *
 * Base models: the harness pulls them from HF by id. Fine-tunes: we first merge
 * the adapter into the base locally (the harness can't load a LoRA adapter from
 * HF) and evaluate the merged model via its `model_path`.
 */
export async function submitEval(p: SubmitEvalParams): Promise<string> {
  let modelName = p.model;
  let modelPath = p.modelPath ?? "";
  let label = p.model;

  if (p.fineTuned) {
    const merged = await mergeFineTuneForEval(p.model); // p.model = train job id
    modelPath = merged.modelPath;
    modelName = merged.label;
    label = merged.label;
  }

  // All eval jobs run under one fixed experiment (hidden from the UI). Create/
  // reuse it and use TL's authoritative id back.
  const experiment = await createTlExperiment(EVAL_EXPERIMENT);
  const name = `eval-${slug(label)}-${p.benchmark}`;
  const env_vars: Record<string, string> = { PYTHONUNBUFFERED: "1" };
  if (p.hfToken) env_vars.HF_TOKEN = p.hfToken;

  return launchProviderTask({
    experimentId: experiment,
    taskName: name,
    run: EVAL_RUN,
    setup: EVAL_SETUP,
    githubRepoUrl: EVAL_GITHUB_URL,
    githubRepoDir: EVAL_GITHUB_DIR,
    accelerators: "NVIDIA:1",
    // Maps onto the harness trainer's `lab.get_config()` keys. `limit` is a
    // string in the trainer (it float-parses it); 1.0 means "no limit".
    parameters: {
      model_name: modelName,
      model_path: modelPath, // harness uses this over model_name when set
      model_adapter: p.modelAdapter ?? "",
      tasks: p.benchmark,
      limit: String(p.limit ?? 0.05),
      // Sent explicitly rather than left to the harness default, so the dtype a
      // run used is visible in its job parameters instead of having to be inferred.
      dtype: p.dtype ?? "bfloat16",
    },
    envVars: env_vars,
    description: `Eval ${label} on ${p.benchmark}`,
    subtype: "EVAL",
  });
}

/**
 * Merge a fine-tune's adapter into its base on the host (peft, via WSL) so the
 * harness can evaluate it by `model_path`. Returns the merged dir's WSL path.
 */
async function mergeFineTuneForEval(jobId: string): Promise<{ modelPath: string; label: string }> {
  // The train job may live in any experiment (Pattern B) — resolve it.
  const experiment = await resolveJobExperiment(jobId);
  const res = await fetch(
    `${TL_ROOT}/experiment/${encodeURIComponent(experiment)}/jobs/${encodeURIComponent(jobId)}`,
    { headers: inferenceHeaders() }
  );
  if (!res.ok) throw new Error(`Fine-tune job "${jobId}" not found (${res.status})`);
  const job = (await res.json()) as {
    job_data?: { task_name?: string; parameters?: { model_name?: string } };
  };
  const base = job.job_data?.parameters?.model_name;
  const name = job.job_data?.task_name;
  if (!base || !name) throw new Error("Could not resolve the base model / name for this fine-tune");
  const tag = `eval-${slug(name)}`;

  // Defense-in-depth (runHostScript already isolates args via argv).
  assertJobId(jobId);
  assertModelId(base);
  assertTag(tag);

  let stdout: string;
  try {
    // Fixed template; values bind to $1/$2/$3 via "$@" — never interpolated.
    ({ stdout } = await runHostScript('bash ~/rantai_merge.sh "$@"', [jobId, base, tag]));
  } catch (err) {
    throw new Error(`Merge for eval failed: ${err instanceof Error ? err.message : err}`);
  }
  // The script prints the merged dir as the last absolute-path line; pick the
  // last line starting with "/" so any trailing log/banner noise is ignored.
  const modelPath = stdout
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("/"))
    .pop();
  if (!modelPath) throw new Error("Merge produced no model path");
  return { modelPath, label: name };
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
    parameters?: { model_name?: string; tasks?: string; limit?: string; dtype?: string };
    launch_progress?: { percent?: number };
    subtype?: string;
    run?: string;
    start_time?: string;
    end_time?: string;
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

/**
 * `limit` as the harness received it — a fraction of the benchmark, "1.0" being
 * all of it. Anything unparseable is left undefined rather than defaulted: a
 * wrong coverage badge is worse than none, because it would be believed.
 */
function parseCoverage(raw?: string): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : undefined;
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
    coverage: parseCoverage(d.parameters?.limit),
    dtype: d.parameters?.dtype,
    startedAt: d.start_time,
    finishedAt: d.end_time,
  };
}

type LmEvalResults = {
  results?: Record<string, Record<string, number | string>>;
  /** Per task: how many questions the benchmark has vs how many `--limit` kept. */
  "n-samples"?: Record<string, { original?: number; effective?: number }>;
};

/**
 * Read a finished eval job's accuracy scores. v0.40.0 stores them as the raw
 * lm-eval results JSON (not `job_data.score`), exposed via `get_eval_results`.
 *
 * Keeps the primary accuracy metrics (`acc`, `acc_norm`) and PAIRS EACH WITH ITS
 * STDERR. The harness emits them as sibling keys — `"acc,none"` next to
 * `"acc_stderr,none"` — and we used to drop the second one. That left the UI
 * showing 79.4% against 78.2% with nothing to say the gap was smaller than the
 * measurement error, which is how noise gets reported as a result.
 */
async function fetchEvalScores(
  jobId: string,
  experiment: string
): Promise<{ scores: EvalScore[]; samples?: number }> {
  try {
    const exp = encodeURIComponent(experiment);
    const res = await tlFetch(
      `/experiment/${exp}/jobs/${encodeURIComponent(jobId)}/get_eval_results?experimentId=${exp}&task=view`
    );
    if (!res.ok) return { scores: [] };
    // The endpoint returns text/csv ("No evaluation results found") when empty.
    if (!(res.headers.get("content-type") ?? "").includes("application/json")) return { scores: [] };
    const data = (await res.json()) as LmEvalResults;
    const out: EvalScore[] = [];
    for (const taskRes of Object.values(data.results ?? {})) {
      // Collect the stderrs first: "acc_stderr,none" -> stderr of "acc".
      const stderrs = new Map<string, number>();
      for (const [key, value] of Object.entries(taskRes)) {
        const metric = key.split(",")[0]; // "acc_stderr,none" -> "acc_stderr"
        // lm-eval writes the string "N/A" when it cannot compute one, so the
        // number check is what keeps that out rather than a cast.
        if (typeof value === "number" && metric.endsWith("_stderr")) {
          stderrs.set(metric.slice(0, -"_stderr".length), value);
        }
      }
      for (const [key, value] of Object.entries(taskRes)) {
        const metric = key.split(",")[0]; // "acc,none" -> "acc"
        if (typeof value === "number" && metric.includes("acc") && !metric.endsWith("_stderr")) {
          out.push({ type: metric, score: value, stderr: stderrs.get(metric) });
        }
      }
    }
    // How many questions were actually scored. Only one task runs per job, so
    // the first entry is this job's — but read it by value rather than assuming
    // the key, since the task name is the benchmark id.
    const samples = Object.values(data["n-samples"] ?? {})[0]?.effective;
    return { scores: out, samples: typeof samples === "number" ? samples : undefined };
  } catch (err) {
    logServerError("fetchEvalScores", err);
    return { scores: [] };
  }
}

/**
 * All eval jobs in the experiment, newest first, with scores for finished ones.
 * v0.40.0 provider jobs are all type=REMOTE, so we list everything (no `slim` —
 * it strips the job_data we classify on) and keep the ones that ran the harness.
 */
export async function fetchEvalJobs(): Promise<EvalJob[]> {
  // Eval jobs are experiment-scoped and can now live in any experiment (Pattern
  // B), so fan out over all of them and merge — tagging each with its experiment
  // so we can read its per-job score artifact from the right place.
  const ids = await allExperimentIds();
  const perExperiment = await Promise.all(
    ids.map(async (experimentId) => {
      try {
        const res = await tlFetch(`/experiment/${encodeURIComponent(experimentId)}/jobs/list`);
        const rows = unwrapList<TlEvalJob>(await res.json().catch(() => []));
        return rows.filter(isEvalJob).map((j) => ({ job: normalize(j), experimentId }));
      } catch {
        return [];
      }
    })
  );
  const tagged = perExperiment
    .flat()
    .sort((a, b) =>
      (b.job.finishedAt || b.job.startedAt || "9999").localeCompare(
        a.job.finishedAt || a.job.startedAt || "9999"
      )
    );
  // Scores live in a per-job artifact, not the list payload — fetch them for
  // finished jobs (from the job's own experiment). A failed score fetch returns
  // [] for that one job only, never blanking the whole list.
  await Promise.all(
    tagged.map(async ({ job, experimentId }) => {
      if (job.status === "COMPLETE" && job.scores.length === 0) {
        const { scores, samples } = await fetchEvalScores(job.id, experimentId);
        job.scores = scores;
        job.samples = samples;
      }
    })
  );
  return tagged.map((t) => t.job);
}

function slug(s: string): string {
  return (s.split("/").pop() ?? s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
