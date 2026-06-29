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
import { execFile } from "node:child_process";

import {
  fetchDownloaded,
  TL_ROOT,
  type CatalogModel,
  type FineTunedModel,
} from "@/lib/models-catalog";
import { inferenceHeaders } from "@/lib/inference";
import { listOllamaModels } from "@/lib/ollama";
import { launchProviderTask } from "@/lib/tl-provider";

export { fetchAdaptors } from "@/lib/models-catalog";

/** All fine-tuning runs live under one experiment so jobs are easy to list. */
export const FINETUNE_EXPERIMENT = "nqr-ft";

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
  } catch {
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
  // Trainable bases = downloaded safetensors models. Exclude GGUF (inference-only,
  // can't be fine-tuned) and our own fused outputs (TransformerLab/ — those are
  // training *results*, not base models).
  const models = downloaded.filter((m) => !m.isGguf && !m.id.startsWith("TransformerLab/"));

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
  if (cData.status === "error") throw new Error(cData.message || "Could not create dataset");

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

/** Column names of a dataset (TL `/data/preview`). */
async function datasetColumns(datasetId: string): Promise<string[]> {
  // Do NOT swallow failures here: an empty column list would make
  // buildFormattingTemplate() produce an empty template and the trainer would
  // run on garbage. Fail loudly so submitFinetune aborts before queuing.
  const res = await fetch(
    `${TL_ROOT}/data/preview?dataset_id=${encodeURIComponent(datasetId)}`,
    { headers: inferenceHeaders() }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Could not read columns for dataset "${datasetId}" (${res.status})${detail ? `: ${detail}` : ""}`
    );
  }
  const body = (await res.json().catch(() => ({}))) as {
    data?: { columns?: Record<string, unknown> };
  };
  const columns = Object.keys(body?.data?.columns ?? {});
  if (columns.length === 0) {
    throw new Error(`Dataset "${datasetId}" has no readable columns — cannot build a training template.`);
  }
  return columns;
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

async function ensureDatasetDownloaded(datasetId: string): Promise<void> {
  const local = await fetchLocalDatasets();
  if (local.some((d) => d.dataset_id === datasetId)) return;
  const res = await fetch(
    `${TL_ROOT}/data/download?dataset_id=${encodeURIComponent(datasetId)}`,
    { headers: inferenceHeaders() }
  );
  if (!res.ok) throw new Error(`Failed to download dataset ${datasetId}`);
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
};

/**
 * Launch a LoRA fine-tune on the local compute provider and return the REMOTE
 * job id. v0.40.0: the launch is self-contained — it clones the GitHub trainer,
 * builds a uv venv from `setup`, then runs it with `parameters` (surfaced to the
 * trainer via `lab.get_config()`). The trainer downloads `baseModel`/`dataset`
 * from Hugging Face by id at runtime.
 */
export async function submitFinetune(p: SubmitFinetuneParams): Promise<string> {
  await ensureExperiment();
  const adaptorName = p.adaptorName.replace(/[^a-zA-Z0-9._-]/g, "-") || "adaptor";

  const env_vars: Record<string, string> = { PYTHONUNBUFFERED: "1" };
  if (p.hfToken) env_vars.HF_TOKEN = p.hfToken;

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
 * Ollama tag for a fine-tune, derived from its adaptor/task name. Must match
 * between listing (to detect "ready") and export (to create the tag).
 */
export function fineTuneTag(name: string): string {
  const slug = (name || "model")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug.startsWith("nqr-") ? slug : `nqr-${slug || "model"}`;
}

type TlListModel = {
  model_id?: string;
  local_path?: string;
  json_data?: { architecture?: string };
};

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
  const tag = fineTuneTag(name);

  // Guard before handing arguments to the shell.
  const safe = (s: string) => /^[a-zA-Z0-9._:/-]+$/.test(s);
  if (![jobId, base, tag].every(safe)) {
    throw new Error("Invalid characters in export arguments");
  }

  await runWslExport(jobId, base, tag);
  return tag;
}

/** Run the host-side serve-fine-tune pipeline in WSL; reject with its output tail. */
function runWslExport(jobId: string, base: string, tag: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd = `bash ~/nqr_serve_finetune.sh ${jobId} ${base} ${tag}`;
    execFile(
      "wsl.exe",
      ["-d", "Ubuntu", "--", "bash", "-lc", cmd],
      { timeout: 9 * 60_000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const tail = `${stdout}\n${stderr}`.trim().split("\n").slice(-6).join("\n");
          reject(new Error(`GGUF export/import failed: ${tail || err.message}`));
        } else {
          resolve();
        }
      }
    );
  });
}

/**
 * Fine-tunes for the model picker: our completed TRAIN jobs, each flagged with
 * whether it's been served to Ollama yet (`ready` + its `loadModelId` tag).
 * `fusedModelId` carries the train job id — the input to {@link exportFineTunedToGguf}.
 */
export async function fetchFineTuned(): Promise<FineTunedModel[]> {
  let rows: TlJob[] = [];
  try {
    const res = await fetch(`${TL_ROOT}/experiment/${FINETUNE_EXPERIMENT}/jobs/list`, {
      headers: inferenceHeaders(),
    });
    const raw = (await res.json().catch(() => [])) as TlJob[] | { data?: TlJob[] };
    rows = Array.isArray(raw) ? raw : (raw.data ?? []);
  } catch {
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
      const tag = fineTuneTag(name);
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
    const res = await fetch(
      `${TL_ROOT}/experiment/${FINETUNE_EXPERIMENT}/jobs/list`,
      { headers: inferenceHeaders() }
    );
    const raw = (await res.json().catch(() => [])) as TlJob[] | { data?: TlJob[] };
    const rows = Array.isArray(raw) ? raw : (raw.data ?? []);
    const jobs = rows.filter(isTrainJob).map(normalizeJob);
    return jobs.reverse();
  } catch {
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
  } catch {
    return null;
  }
}

