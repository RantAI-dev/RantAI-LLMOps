/**
 * Server-only helpers for the Fine-tune feature (`/api/finetune/*`).
 *
 * Built on Transformer Lab's training API. v0.40.0 paradigm (compute providers):
 * create/reuse an experiment → launch a GitHub-hosted trainer task on the local
 * compute provider (`POST /compute_provider/providers/{id}/launch/`) → poll the
 * resulting REMOTE job. We use the `unsloth-llm-train` gallery trainer, which is
 * memory-efficient (4-bit + LoRA) and well-suited to small GPUs.
 *
 * Key differences from the old (v0.30.3) plugin flow:
 *  - The trainer pulls the base model AND dataset straight from Hugging Face by
 *    id at runtime (`FastLanguageModel.from_pretrained` / `load_dataset`), so the
 *    `baseModel`/`dataset` values must be HF-resolvable ids — they are NOT read
 *    from TL's local workspace.
 *  - Hyperparameters travel in the launch `parameters` map and reach the trainer
 *    via `lab.get_config()`. The trainer DOES honour `max_steps`.
 *  - The trainer saves a fused model via `lab.save_model(...)` into the job's
 *    artifacts; progress/log stream to the job via the `lab` SDK.
 */
import { runHostScript } from "@/lib/host-runner";
import {
  fetchDownloaded,
  TL_ROOT,
  type CatalogModel,
  type FineTunedModel,
} from "@/lib/models-catalog";
import { inferenceHeaders } from "@/lib/inference";
import { listOllamaModels } from "@/lib/ollama";
import { launchProviderTask } from "@/lib/tl-provider";
import { assertJobId, assertModelId, assertTag } from "@/lib/validate";
import { tlFetch, unwrapList } from "@/lib/tl-fetch";
import { logServerError } from "@/lib/log";

export { fetchAdaptors } from "@/lib/models-catalog";

/** All fine-tuning runs live under one experiment so jobs are easy to list. */
export { FINETUNE_EXPERIMENT } from "@/lib/tl-constants";
import { FINETUNE_EXPERIMENT } from "@/lib/tl-constants";

/**
 * The GitHub-hosted trainer the local compute provider clones and runs. Unsloth
 * (4-bit + LoRA) keeps memory low enough for modest GPUs. The `run`/`setup`
 * mirror its `task.yaml`; the provider builds a fresh uv venv from `setup`.
 */
const TRAINER_GITHUB_URL = "https://github.com/transformerlab/transformerlab-app";
const TRAINER_GITHUB_DIR = "api/transformerlab/galleries/examples/unsloth-llm-train";
const TRAINER_SETUP =
  "uv pip install unsloth==2025.12.5 transformers==4.57.3 torch==2.10.0 datasets huggingface-hub wandb";
const TRAINER_RUN = "python unsloth-llm-train/train.py";

/**
 * Unsloth GRPO (RL) trainer — reasoning fine-tune. It teaches the model to emit
 * `<reasoning>…</reasoning><answer>…</answer>`, rewarded by whether the extracted
 * answer matches the dataset's answer field (+ format correctness). Same launch
 * mechanism as SFT — just a different gallery trainer + `parameters` shape.
 */
const GRPO_GITHUB_DIR = "api/transformerlab/galleries/examples/unsloth-grpo-train";
const GRPO_SETUP =
  "uv pip install trl==0.24.0 bitsandbytes==0.49.2 unsloth==2026.3.3 unsloth-zoo==2026.3.1 datasets==4.3.0 torch==2.10.0";
const GRPO_RUN = "python unsloth-grpo-train/train.py";

/**
 * Unsloth text-to-speech trainer — LoRA-tunes an Orpheus/CSM audio model on a
 * dataset of (audio, text) pairs. Same launch mechanism as SFT/GRPO. NOTE: the
 * default `unsloth/orpheus-3b-0.1-ft` is a 3B audio model — the trainer's own
 * task.yaml asks for an RTX 3090; it will OOM on ~6 GB GPUs. Wired so it's
 * selectable + correct; running it to completion needs a bigger GPU.
 */
const TTS_GITHUB_DIR = "api/transformerlab/galleries/examples/unsloth-text-to-speech-train";
const TTS_SETUP =
  "uv pip install unsloth snac librosa soundfile transformers==4.52.3 datasets==3.6.0 torch==2.10.0";
const TTS_RUN = "python unsloth-text-to-speech-train/train.py";
/** Orpheus TTS base model — the trainer's default; shown as a base option in TTS mode. */
export const TTS_DEFAULT_MODEL = "unsloth/orpheus-3b-0.1-ft";
export const TTS_DEFAULT_ARCHITECTURE = "OrpheusForConditionalGeneration";

export type FinetuneDataset = {
  id: string;
  name: string;
  description?: string;
  sizeMb: number | null;
  downloaded: boolean;
};

export type FinetuneOptions = {
  models: CatalogModel[]; // trainable (non-GGUF) downloaded models
  datasets: FinetuneDataset[];
};

export type TrainingJob = {
  id: string;
  name: string;
  status: string; // QUEUED | RUNNING | COMPLETE | FAILED | STOPPED
  progress: number;
  model?: string;
  dataset?: string;
  adaptorName?: string;
};

/**
 * Recommended base models to fine-tune. v0.40.0 trains from Hugging Face by id
 * (the trainer pulls the model at runtime), so these aren't "downloaded" — they
 * just need to be HF-resolvable. Kept small enough to QLoRA on a ~6 GB GPU.
 */
export const RECOMMENDED_MODELS: CatalogModel[] = [
  {
    id: "unsloth/Qwen2.5-0.5B-Instruct",
    name: "Qwen2.5 0.5B Instruct",
    architecture: "Qwen2ForCausalLM",
    sizeMb: 1000,
    isGguf: false,
    downloaded: false,
  },
  {
    id: "unsloth/Qwen2.5-1.5B-Instruct",
    name: "Qwen2.5 1.5B Instruct",
    architecture: "Qwen2ForCausalLM",
    sizeMb: 3000,
    isGguf: false,
    downloaded: false,
  },
  {
    id: "unsloth/Llama-3.2-1B-Instruct",
    name: "Llama 3.2 1B Instruct",
    architecture: "LlamaForCausalLM",
    sizeMb: 2500,
    isGguf: false,
    downloaded: false,
  },
  {
    id: "HuggingFaceTB/SmolLM-135M-Instruct",
    name: "SmolLM 135M Instruct",
    architecture: "LlamaForCausalLM",
    sizeMb: 270,
    isGguf: false,
    downloaded: false,
  },
];

/** Small, instruction-style datasets that fine-tune quickly on modest GPUs. */
export const RECOMMENDED_DATASETS: FinetuneDataset[] = [
  {
    id: "Trelis/touch-rugby-rules",
    name: "Touch Rugby Rules",
    description: "10 Q&A rows — tiny, finishes in seconds. Great for a first run.",
    sizeMb: 0.1,
    downloaded: false,
  },
  {
    id: "tatsu-lab/alpaca",
    name: "Alpaca (52k)",
    description: "Classic instruction-following dataset.",
    sizeMb: 24,
    downloaded: false,
  },
  {
    id: "databricks/databricks-dolly-15k",
    name: "Dolly 15k",
    description: "Open instruction-following records.",
    sizeMb: 13,
    downloaded: false,
  },
];

type TlDataset = {
  dataset_id?: string;
  size?: number | null;
  json_data?: { description?: string };
};

/** Datasets present on disk (TL `/data/list`) — includes user-created ones. */
async function fetchLocalDatasets(): Promise<TlDataset[]> {
  try {
    const res = await fetch(`${TL_ROOT}/data/list`, { headers: inferenceHeaders() });
    if (!res.ok) return [];
    const rows = (await res.json()) as TlDataset[];
    return Array.isArray(rows) ? rows.filter((r) => r.dataset_id) : [];
  } catch (err) {
    logServerError("fetchLocalDatasets", err);
    return [];
  }
}

/** Lean dataset row shape for the Dataset Registry page. */
export type TlDatasetRow = {
  id: string;
  description: string;
  sizeMb: number | null;
};

/** Real datasets on disk, shaped for the Dataset Registry. */
export async function listTlDatasets(): Promise<TlDatasetRow[]> {
  const rows = await fetchLocalDatasets();
  return rows.map((d) => ({
    id: d.dataset_id as string,
    description: d.json_data?.description || "",
    sizeMb: typeof d.size === "number" && d.size > 0 ? d.size / (1024 * 1024) : null,
  }));
}

export type DatasetPreview = { columns: string[]; rows: Array<Record<string, string>> };

/**
 * Real rows from a dataset (TL `/data/preview`). TL returns column-oriented
 * data (`{ data: { columns: { col: [values] } } }`); we transpose it into row
 * objects and stringify cell values so the UI can render arbitrary schemas.
 */
export async function previewTlDataset(id: string, limit = 25): Promise<DatasetPreview> {
  const url = `${TL_ROOT}/data/preview?dataset_id=${encodeURIComponent(id)}&limit=${limit}`;
  const res = await fetch(url, { headers: inferenceHeaders() });
  if (!res.ok) throw new Error(`preview ${res.status}`);
  const body = (await res.json().catch(() => ({}))) as {
    status?: string;
    data?: { columns?: Record<string, unknown[]> };
  };
  const cols = body.data?.columns ?? {};
  const columns = Object.keys(cols);
  if (columns.length === 0) return { columns: [], rows: [] };
  const n = Math.max(0, ...columns.map((c) => (Array.isArray(cols[c]) ? cols[c].length : 0)));
  const rows: Array<Record<string, string>> = [];
  for (let i = 0; i < n; i++) {
    const row: Record<string, string> = {};
    for (const c of columns) {
      const v = (cols[c] as unknown[])[i];
      row[c] = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
    }
    rows.push(row);
  }
  return { columns, rows };
}

/** Form data for the Fine-tune page: trainable models + datasets (local + recommended). */
export async function fetchFinetuneOptions(): Promise<FinetuneOptions> {
  const [downloaded, local] = await Promise.all([fetchDownloaded(), fetchLocalDatasets()]);
  // Trainable bases = downloaded safetensors models (exclude GGUF and our own
  // TransformerLab/ fused outputs) PLUS recommended HF bases. v0.40.0 pulls the
  // base from HF at train time, so the recommended ones are usable even though
  // they aren't on disk — without them the picker is empty on a fresh workspace.
  const local_bases = downloaded.filter((m) => !m.isGguf && !m.id.startsWith("TransformerLab/"));
  const haveIds = new Set(local_bases.map((m) => m.id));
  const models = [...local_bases, ...RECOMMENDED_MODELS.filter((m) => !haveIds.has(m.id))];

  const localIds = new Set(local.map((d) => d.dataset_id));
  // User-created / downloaded datasets first (all ready to use)...
  const localDatasets: FinetuneDataset[] = local.map((d) => ({
    id: d.dataset_id as string,
    name: d.dataset_id as string,
    description: d.json_data?.description || undefined,
    sizeMb: typeof d.size === "number" && d.size > 0 ? d.size / (1024 * 1024) : null,
    downloaded: true,
  }));
  // ...then recommended ones not already local.
  const recommended = RECOMMENDED_DATASETS.filter((d) => !localIds.has(d.id)).map((d) => ({
    ...d,
    downloaded: false,
  }));

  return { models, datasets: [...localDatasets, ...recommended] };
}

/** Delete a local dataset (TL `/data/delete`). Returns whether TL accepted it. */
export async function deleteDataset(datasetId: string): Promise<boolean> {
  try {
    const res = await fetch(`${TL_ROOT}/data/delete?dataset_id=${encodeURIComponent(datasetId)}`, {
      headers: inferenceHeaders(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Create a local dataset from prompt/completion rows (TL `/data/new` +
 * `/data/fileupload`). Returns the slugified dataset id, ready to fine-tune on.
 */
export async function createDataset(
  name: string,
  rows: Array<{ prompt: string; completion: string }>
): Promise<string> {
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  if (!id) throw new Error("Dataset name is required");
  if (rows.length === 0) throw new Error("At least one row is required");

  const created = await fetch(
    `${TL_ROOT}/data/new?dataset_id=${encodeURIComponent(id)}`,
    { headers: inferenceHeaders() }
  );
  const cData = (await created.json().catch(() => ({}))) as { status?: string; message?: string };
  // Check the HTTP status too: a 4xx/5xx with a non-JSON body would otherwise
  // parse to `{}` and slip past the `status === "error"` check, leaving us to
  // upload into a dataset that was never created.
  if (!created.ok || cData.status === "error") {
    throw new Error(cData.message || `Could not create dataset (${created.status})`);
  }

  const jsonl = rows
    .map((r) => JSON.stringify({ prompt: r.prompt, completion: r.completion }))
    .join("\n");
  const form = new FormData();
  form.append("files", new Blob([jsonl], { type: "application/jsonl" }), `${id}_train.jsonl`);

  const up = await fetch(`${TL_ROOT}/data/fileupload?dataset_id=${encodeURIComponent(id)}`, {
    method: "POST",
    headers: inferenceHeaders(), // multipart boundary is set by fetch from the FormData
    body: form,
  });
  if (!up.ok) throw new Error(`Dataset upload failed (${up.status})`);
  return id;
}

/**
 * Build a Jinja-ish formatting template from a dataset's columns so the trainer
 * knows how to turn a row into a single training string. Covers the common
 * instruction shapes; falls back to concatenating whatever columns exist.
 */
export function buildFormattingTemplate(columns: string[]): string {
  const has = (c: string) => columns.includes(c);
  if (has("instruction") && has("output")) {
    const input = has("input") ? "\n\n### Input:\n{{input}}" : "";
    return `### Instruction:\n{{instruction}}${input}\n\n### Response:\n{{output}}`;
  }
  if (has("prompt") && has("completion")) {
    return `### Question:\n{{prompt}}\n\n### Answer:\n{{completion}}`;
  }
  if (has("question") && has("answer")) {
    return `### Question:\n{{question}}\n\n### Answer:\n{{answer}}`;
  }
  if (has("text")) return `{{text}}`;
  // Fallback: join all columns.
  return columns.map((c) => `{{${c}}}`).join("\n");
}

async function ensureExperiment(): Promise<void> {
  // create is idempotent enough for our purposes; ignore "already exists".
  await fetch(`${TL_ROOT}/experiment/create?name=${FINETUNE_EXPERIMENT}`, {
    headers: inferenceHeaders(),
  }).catch(() => {});
}

export type SubmitFinetuneParams = {
  /** HF-resolvable base model id (e.g. "unsloth/Qwen2.5-0.5B-Instruct"). */
  baseModel: string;
  baseModelArchitecture?: string;
  /** HF-resolvable dataset id (e.g. "Trelis/touch-rugby-rules"). */
  dataset: string;
  adaptorName: string;
  epochs?: number;
  batchSize?: number;
  learningRate?: number;
  loraR?: number;
  loraAlpha?: number;
  /** Cap on optimizer steps. The unsloth trainer honours this (-1 = unlimited). */
  maxSteps?: number;
  /** Optional HF token for gated models/datasets. */
  hfToken?: string;
  /** Training method. "sft" (default) = instruction tuning; "grpo" = RL reasoning; "tts" = text-to-speech. */
  method?: "sft" | "grpo" | "tts";
  /** GRPO only: the dataset's input/output column names + KL beta. */
  datasetInputField?: string;
  datasetOutputField?: string;
  beta?: number;
  /** TTS only: the dataset's audio + text column names + audio sampling rate. */
  audioColumn?: string;
  textColumn?: string;
  samplingRate?: number;
};

/**
 * Launch a LoRA fine-tune on the local compute provider and return the REMOTE
 * job id. v0.40.0: the launch is self-contained — it clones the GitHub trainer,
 * builds a uv venv from `setup`, then runs it with `parameters` (surfaced to the
 * trainer via `lab.get_config()`). The trainer downloads `baseModel`/`dataset`
 * from Hugging Face by id at runtime.
 */
export async function submitFinetune(p: SubmitFinetuneParams): Promise<string> {
  // Validate at the edge: HF-resolvable ids, surfaced as a clear early error.
  assertModelId(p.baseModel);
  assertModelId(p.dataset);
  await ensureExperiment();
  const adaptorName = p.adaptorName.replace(/[^a-zA-Z0-9._-]/g, "-") || "adaptor";

  const env_vars: Record<string, string> = { PYTHONUNBUFFERED: "1" };
  if (p.hfToken) env_vars.HF_TOKEN = p.hfToken;

  if (p.method === "grpo") {
    // GRPO (RL/reasoning) — maps onto the unsloth-grpo-train `lab.get_config()`
    // keys. The reasoning tags / system prompt / templates use the trainer's own
    // sensible defaults, so we only pass the essentials.
    return launchProviderTask({
      experimentId: FINETUNE_EXPERIMENT,
      taskName: adaptorName,
      run: GRPO_RUN,
      setup: GRPO_SETUP,
      githubRepoUrl: TRAINER_GITHUB_URL,
      githubRepoDir: GRPO_GITHUB_DIR,
      accelerators: "NVIDIA:1",
      parameters: {
        model_name: p.baseModel,
        dataset: p.dataset,
        dataset_input_field: p.datasetInputField ?? "question",
        dataset_output_field: p.datasetOutputField ?? "answer",
        learning_rate: p.learningRate ?? 0.00005,
        num_train_epochs: p.epochs ?? 1,
        batch_size: p.batchSize ?? 1,
        max_steps: p.maxSteps ?? 50,
        lora_r: p.loraR ?? 16,
        lora_alpha: p.loraAlpha ?? 32,
        lora_dropout: 0.05,
        maximum_sequence_length: 1024,
        maximum_completion_length: 512,
        beta: p.beta ?? 0.04,
        num_iterations: 2,
      },
      envVars: env_vars,
      description: `GRPO reasoning fine-tune "${adaptorName}" on ${p.baseModel} with ${p.dataset}`,
      subtype: "TRAIN",
    });
  }

  if (p.method === "tts") {
    // Text-to-speech — maps onto the unsloth-text-to-speech-train config keys.
    // The base model is an Orpheus/CSM audio model, and the dataset needs an
    // audio column + a text column (defaults match bosonai/EmergentTTS-Eval).
    return launchProviderTask({
      experimentId: FINETUNE_EXPERIMENT,
      taskName: adaptorName,
      run: TTS_RUN,
      setup: TTS_SETUP,
      githubRepoUrl: TRAINER_GITHUB_URL,
      githubRepoDir: TTS_GITHUB_DIR,
      accelerators: "NVIDIA:1",
      parameters: {
        model_name: p.baseModel,
        model_architecture: p.baseModelArchitecture ?? TTS_DEFAULT_ARCHITECTURE,
        dataset: p.dataset,
        audio_column_name: p.audioColumn ?? "audio",
        text_column_name: p.textColumn ?? "text_to_synthesize",
        learning_rate: p.learningRate ?? 0.00005,
        num_train_epochs: p.epochs ?? 1,
        batch_size: p.batchSize ?? 1,
        max_steps: p.maxSteps ?? 60,
        lora_r: p.loraR ?? 16,
        lora_alpha: p.loraAlpha ?? 32,
        lora_dropout: 0.0,
        maximum_sequence_length: 1024,
        max_grad_norm: 0.3,
        sampling_rate: p.samplingRate ?? 24000,
      },
      envVars: env_vars,
      description: `TTS fine-tune "${adaptorName}" on ${p.baseModel} with ${p.dataset}`,
      subtype: "TRAIN",
    });
  }

  return launchProviderTask({
    experimentId: FINETUNE_EXPERIMENT,
    taskName: adaptorName,
    run: TRAINER_RUN,
    setup: TRAINER_SETUP,
    githubRepoUrl: TRAINER_GITHUB_URL,
    githubRepoDir: TRAINER_GITHUB_DIR,
    accelerators: "NVIDIA:1",
    // Maps 1:1 onto the unsloth-llm-train trainer's `lab.get_config()` keys.
    parameters: {
      model_name: p.baseModel,
      dataset: p.dataset,
      lr: p.learningRate ?? 0.0002,
      num_train_epochs: p.epochs ?? 1,
      batch_size: p.batchSize ?? 2,
      gradient_accumulation_steps: 4,
      warmup_steps: 5,
      max_steps: p.maxSteps ?? 60,
      max_seq_length: 2048,
      lora_r: p.loraR ?? 16,
      lora_alpha: p.loraAlpha ?? 16,
      lora_dropout: 0.05,
      logging_steps: 1,
      save_steps: 50,
      weight_decay: 0.01,
      dataloader_num_workers: 0,
    },
    envVars: env_vars,
    description: `LoRA fine-tune "${adaptorName}" on ${p.baseModel} with ${p.dataset}`,
    subtype: "TRAIN",
  });
}

/** Trainer dir basename — used to recognise our TRAIN jobs (all are type=REMOTE). */
const TRAINER_DIR_TAG = "unsloth-llm-train";

/** A job is one of our fine-tune runs if it ran the trainer (or is tagged TRAIN). */
function isTrainJob(j: TlJob): boolean {
  const d = j.job_data ?? {};
  if (d.subtype === "TRAIN") return true;
  return typeof d.run === "string" && d.run.includes(TRAINER_DIR_TAG);
}

/**
 * Ollama tag for a fine-tune. Includes the train job id so two runs whose names
 * slugify to the same value don't collide — without it, the second export would
 * overwrite the first and both would report "ready" pointing at one shared tag.
 * Must match between listing (to detect "ready") and export (to create the tag).
 */
export function fineTuneTag(name: string, jobId: string): string {
  const slug = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/(^-|-$)/g, "");
  const nameSlug = (slug(name || "model") || "model").replace(/^nqr-/, "");
  const jobSlug = slug(jobId) || "0";
  return `nqr-${nameSlug}-${jobSlug}`;
}

/**
 * Serve a fine-tune by exporting it to GGUF and importing it into Ollama. Takes
 * the TRAIN job id and returns the Ollama tag, ready to chat.
 *
 * v0.40.0: the trainer saves a LoRA adapter under the train job's models dir. We
 * merge it into the fp16 base, convert to GGUF (llama.cpp), and `ollama create`.
 * The heavy ML tooling and Ollama both live on the host, so the BFF drives a
 * host-side WSL script rather than doing it in-process. Long-running (minutes).
 */
export async function exportFineTunedToGguf(jobId: string): Promise<string> {
  // Resolve the base model + adaptor name from the train job.
  const jobRes = await fetch(
    `${TL_ROOT}/experiment/${FINETUNE_EXPERIMENT}/jobs/${encodeURIComponent(jobId)}`,
    { headers: inferenceHeaders() }
  );
  if (!jobRes.ok) throw new Error(`Training job "${jobId}" not found (${jobRes.status})`);
  const job = (await jobRes.json()) as TlJob;
  const d = job.job_data ?? {};
  const base = d.parameters?.model_name;
  const name = d.task_name;
  if (!base || !name) {
    throw new Error("Could not resolve the base model / name for this fine-tune");
  }
  const tag = fineTuneTag(name, jobId);

  // Defense-in-depth (runHostScript already isolates args via argv).
  assertJobId(jobId);
  assertModelId(base);
  assertTag(tag);

  // Fixed command template; values bind to $1/$2/$3 via "$@" — never interpolated.
  try {
    await runHostScript('bash ~/nqr_serve_finetune.sh "$@"', [jobId, base, tag]);
  } catch (err) {
    throw new Error(`GGUF export/import failed: ${err instanceof Error ? err.message : err}`);
  }
  return tag;
}

/**
 * Fine-tunes for the model picker: our completed TRAIN jobs, each flagged with
 * whether it's been served to Ollama yet (`ready` + its `loadModelId` tag).
 * `fusedModelId` carries the train job id — the input to {@link exportFineTunedToGguf}.
 */
export async function fetchFineTuned(): Promise<FineTunedModel[]> {
  let rows: TlJob[] = [];
  try {
    const res = await tlFetch(`/experiment/${FINETUNE_EXPERIMENT}/jobs/list`);
    rows = unwrapList<TlJob>(await res.json().catch(() => []));
  } catch (err) {
    logServerError("fetchFineTuned", err);
    return [];
  }
  const servable = new Set(
    (await listOllamaModels()).map((m) => m.id.replace(/:latest$/, ""))
  );
  return rows
    .filter(isTrainJob)
    .filter((j) => String(j.status ?? "").toUpperCase() === "COMPLETE")
    .map((j) => {
      const d = j.job_data ?? {};
      const name = d.task_name ?? `Job ${j.id}`;
      const tag = fineTuneTag(name, String(j.id ?? ""));
      const ready = servable.has(tag);
      return {
        name,
        baseModelName: d.parameters?.model_name ?? "",
        fusedModelId: String(j.id ?? ""), // = train job id (export input)
        ready,
        loadModelId: ready ? tag : null,
      } satisfies FineTunedModel;
    })
    .reverse();
}

type TlJob = {
  id?: number | string;
  status?: string;
  progress?: number;
  job_data?: {
    // v0.30.3 plugin jobs
    template_name?: string;
    model_name?: string;
    dataset?: string;
    // v0.40.0 provider (REMOTE) jobs
    task_name?: string;
    parameters?: { model_name?: string; dataset?: string };
    launch_progress?: { percent?: number };
    subtype?: string;
    run?: string;
  };
};

function normalizeJob(j: TlJob): TrainingJob {
  const d = j.job_data ?? {};
  const name = d.task_name ?? d.template_name ?? `Job ${j.id}`;
  // Provider jobs report progress under launch_progress until the trainer's
  // lab.update_progress() takes over; fall back to whichever exists.
  const progress =
    typeof j.progress === "number" && j.progress > 0
      ? j.progress
      : typeof d.launch_progress?.percent === "number"
        ? d.launch_progress.percent
        : 0;
  return {
    id: String(j.id ?? ""),
    name,
    status: j.status ?? "UNKNOWN",
    progress,
    model: d.parameters?.model_name ?? d.model_name,
    dataset: d.parameters?.dataset ?? d.dataset,
    adaptorName: d.task_name ?? d.template_name,
  };
}

/**
 * All training jobs in our fine-tune experiment, newest first. v0.40.0 provider
 * jobs are all type=REMOTE, so we list everything (no `slim` — it strips the
 * job_data we classify on) and keep the ones that ran our trainer.
 */
export async function fetchTrainingJobs(): Promise<TrainingJob[]> {
  try {
    const res = await tlFetch(`/experiment/${FINETUNE_EXPERIMENT}/jobs/list`);
    const rows = unwrapList<TlJob>(await res.json().catch(() => []));
    const jobs = rows.filter(isTrainJob).map(normalizeJob);
    return jobs.reverse();
  } catch (err) {
    logServerError("fetchTrainingJobs", err);
    return [];
  }
}

/** Ask a running training job to stop. Returns whether TL accepted the request. */
export async function stopTrainingJob(jobId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${TL_ROOT}/experiment/${FINETUNE_EXPERIMENT}/jobs/${encodeURIComponent(jobId)}/stop`,
      { headers: inferenceHeaders() }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Delete a training job record. Returns whether TL accepted it. (v0.40.0: DELETE method.) */
export async function deleteTrainingJob(jobId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${TL_ROOT}/experiment/${FINETUNE_EXPERIMENT}/jobs/${encodeURIComponent(jobId)}`,
      { method: "DELETE", headers: inferenceHeaders() }
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Single training job status (v0.40.0: `/experiment/{id}/jobs/{id}`). */
export async function fetchTrainingJob(id: string): Promise<TrainingJob | null> {
  try {
    const res = await fetch(
      `${TL_ROOT}/experiment/${FINETUNE_EXPERIMENT}/jobs/${encodeURIComponent(id)}`,
      { headers: inferenceHeaders() }
    );
    if (!res.ok) return null;
    return normalizeJob((await res.json()) as TlJob);
  } catch (err) {
    logServerError("fetchTrainingJob", err);
    return null;
  }
}

