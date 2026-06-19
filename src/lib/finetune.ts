/**
 * Server-only helpers for the Fine-tune feature (`/api/finetune/*`).
 *
 * Built entirely on Transformer Lab's training API — no new backend. The flow we
 * drive (proven end-to-end): create/reuse an experiment → create a TRAIN task
 * (`PUT /tasks/new_task`) → queue it (`/tasks/{id}/queue`) → poll the job. The
 * trainer plugin (`llama_trainer`) produces a LoRA adaptor that shows up under
 * the model's PEFTs.
 *
 * Gotchas baked in here (learned the hard way):
 *  - `model_name`/`dataset_name` must live in the task `inputs`, not `config`
 *    (the queue step reads them from there).
 *  - The plugin ignores `max_steps`; training length is controlled by epochs and
 *    dataset size.
 *  - Only non-GGUF (safetensors) models are trainable.
 */
import { fetchDownloaded, TL_ROOT, type CatalogModel } from "@/lib/models-catalog";
import { inferenceHeaders } from "@/lib/inference";

export { fetchAdaptors } from "@/lib/models-catalog";

/** All fine-tuning runs live under one experiment so jobs are easy to list. */
export const FINETUNE_EXPERIMENT = "nqr-ft";

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

/** Delete a local dataset (TL `/data/delete`). */
export async function deleteDataset(datasetId: string): Promise<void> {
  await fetch(`${TL_ROOT}/data/delete?dataset_id=${encodeURIComponent(datasetId)}`, {
    headers: inferenceHeaders(),
  }).catch(() => {});
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
  try {
    const res = await fetch(
      `${TL_ROOT}/data/preview?dataset_id=${encodeURIComponent(datasetId)}`,
      { headers: inferenceHeaders() }
    );
    const body = (await res.json()) as { data?: { columns?: Record<string, unknown> } };
    return Object.keys(body?.data?.columns ?? {});
  } catch {
    return [];
  }
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
  baseModel: string;
  baseModelArchitecture?: string;
  dataset: string;
  adaptorName: string;
  epochs?: number;
  batchSize?: number;
  learningRate?: number;
  loraR?: number;
  loraAlpha?: number;
};

/**
 * Create + queue a LoRA fine-tune. Returns the TL job id. Auto-downloads the
 * dataset if needed and derives the formatting template from its columns.
 */
export async function submitFinetune(p: SubmitFinetuneParams): Promise<string> {
  await ensureExperiment();
  await ensureDatasetDownloaded(p.dataset);

  // Free VRAM before training: a modest GPU can't hold an inference worker and
  // a training run at once, so we stop any loaded model first (best-effort).
  await fetch(`${TL_ROOT}/server/worker_stop`, { headers: inferenceHeaders() }).catch(() => {});

  const columns = await datasetColumns(p.dataset);
  const formattingTemplate = buildFormattingTemplate(columns);
  const adaptorName = p.adaptorName.replace(/[^a-zA-Z0-9._-]/g, "-") || "adaptor";

  const taskBody = {
    name: adaptorName,
    type: "TRAIN",
    plugin: "llama_trainer",
    experiment_id: FINETUNE_EXPERIMENT,
    inputs: {
      model_name: p.baseModel,
      model_architecture: p.baseModelArchitecture ?? "",
      dataset_name: p.dataset,
    },
    outputs: { adaptor_name: adaptorName },
    config: {
      plugin_name: "llama_trainer",
      model_name: p.baseModel,
      model_architecture: p.baseModelArchitecture ?? "",
      dataset_name: p.dataset,
      _tlab_recipe_models: { path: p.baseModel },
      _tlab_recipe_datasets: { path: p.dataset },
      formatting_template: formattingTemplate,
      lora_r: p.loraR ?? 8,
      lora_alpha: p.loraAlpha ?? 16,
      lora_dropout: 0.05,
      num_train_epochs: p.epochs ?? 1,
      batch_size: p.batchSize ?? 1,
      learning_rate: p.learningRate ?? 0.0002,
      learning_rate_schedule: "constant",
      adaptor_name: adaptorName,
      template_name: adaptorName,
      // Merge the LoRA into the base and save a standalone model. TL's
      // load-adaptor-on-base inference path is buggy (size mismatch), so we
      // serve the fused model directly instead — the production-standard way.
      fuse_model: true,
    },
  };

  const created = await fetch(`${TL_ROOT}/tasks/new_task`, {
    method: "PUT",
    headers: inferenceHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(taskBody),
  });
  if (!created.ok) {
    const detail = await created.text().catch(() => "");
    throw new Error(detail || `Failed to create training task (${created.status})`);
  }

  // Find the task we just created and queue it.
  const listRes = await fetch(`${TL_ROOT}/tasks/list_by_type?type=TRAIN`, {
    headers: inferenceHeaders(),
  });
  const tasks = (await listRes.json().catch(() => [])) as Array<{ id?: string; name?: string }>;
  const task = (Array.isArray(tasks) ? tasks : []).find((t) => t.name === adaptorName);
  if (!task?.id) throw new Error("Training task was created but could not be found to queue");

  const queued = await fetch(`${TL_ROOT}/tasks/${task.id}/queue`, { headers: inferenceHeaders() });
  const qData = (await queued.json().catch(() => ({}))) as { id?: number; detail?: string };
  if (!queued.ok || qData.id == null) {
    throw new Error(qData.detail || `Failed to queue training job (${queued.status})`);
  }
  return String(qData.id);
}

type TlListModel = {
  model_id?: string;
  local_path?: string;
  json_data?: { architecture?: string };
};

/**
 * Export a fused (merged) fine-tuned model to GGUF so it can be served by
 * llama.cpp (TL's safetensors inference path is buggy). Drives TL's exporter:
 * point the experiment at the fused model, then call `run_exporter_script`
 * twice — once to create the job, once with the job id to actually run it
 * (TL's job runner doesn't auto-run export jobs). Returns when the GGUF exists.
 */
export async function exportFineTunedToGguf(fusedModelId: string): Promise<void> {
  // Resolve the fused model's local dir + architecture.
  const listRes = await fetch(`${TL_ROOT}/model/list`, { headers: inferenceHeaders() });
  const all = (await listRes.json().catch(() => [])) as TlListModel[];
  const model = (Array.isArray(all) ? all : []).find((m) => m.model_id === fusedModelId);
  if (!model) throw new Error(`Fused model "${fusedModelId}" not found`);

  // TL is flaky about populating local_path; reconstruct the dir if missing.
  let localPath = model.local_path;
  if (!localPath) {
    const ref = all.find((m) => m.local_path?.includes("/models/"));
    if (ref?.local_path) {
      const modelsDir = ref.local_path.replace(/\/models\/.*$/, "/models");
      localPath = `${modelsDir}/${fusedModelId.replace(/^TransformerLab\//, "")}`;
    }
  }
  if (!localPath) throw new Error(`Could not resolve a local path for "${fusedModelId}"`);

  // Point the experiment's foundation at the fused model (the exporter reads it).
  await fetch(`${TL_ROOT}/experiment/${FINETUNE_EXPERIMENT}/update_configs`, {
    method: "POST",
    headers: inferenceHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      foundation: fusedModelId,
      foundation_filename: localPath,
      foundation_model_architecture: model.json_data?.architecture ?? "",
    }),
  });

  const params = new URLSearchParams({
    plugin_name: "gguf_exporter",
    plugin_architecture: "GGUF",
    plugin_params: JSON.stringify({ outtype: "q8_0" }),
  });
  const url = `${TL_ROOT}/experiment/${FINETUNE_EXPERIMENT}/export/run_exporter_script?${params.toString()}`;

  // 1) create the export job
  const createRes = await fetch(url, { headers: inferenceHeaders() });
  const jobId = String(await createRes.json().catch(() => "")).replace(/"/g, "");
  if (!jobId || jobId === "null") throw new Error("Could not create export job");

  // 2) run it (blocks until the conversion finishes)
  const runRes = await fetch(`${url}&job_id=${encodeURIComponent(jobId)}`, {
    headers: inferenceHeaders(),
  });
  const data = (await runRes.json().catch(() => ({}))) as { status?: string; message?: string };
  if (data.status === "error") throw new Error(data.message || "Export failed");
}

type TlJob = {
  id?: number | string;
  status?: string;
  progress?: number;
  job_data?: { template_name?: string; model_name?: string; dataset?: string };
};

function normalizeJob(j: TlJob): TrainingJob {
  return {
    id: String(j.id ?? ""),
    name: j.job_data?.template_name ?? `Job ${j.id}`,
    status: j.status ?? "UNKNOWN",
    progress: typeof j.progress === "number" ? j.progress : 0,
    model: j.job_data?.model_name,
    dataset: j.job_data?.dataset,
    adaptorName: j.job_data?.template_name,
  };
}

/** All training jobs in our fine-tune experiment, newest first. */
export async function fetchTrainingJobs(): Promise<TrainingJob[]> {
  try {
    const res = await fetch(
      `${TL_ROOT}/jobs/list?experimentId=${FINETUNE_EXPERIMENT}&type=TRAIN`,
      { headers: inferenceHeaders() }
    );
    const rows = (await res.json().catch(() => [])) as TlJob[];
    const jobs = (Array.isArray(rows) ? rows : []).map(normalizeJob);
    return jobs.reverse();
  } catch {
    return [];
  }
}

/** Ask a running training job to stop (TL flags `stop` in its job data). */
export async function stopTrainingJob(jobId: string): Promise<void> {
  await fetch(
    `${TL_ROOT}/jobs/${encodeURIComponent(jobId)}/stop?experimentId=${FINETUNE_EXPERIMENT}`,
    { headers: inferenceHeaders() }
  ).catch(() => {});
}

/** Delete a training job record. */
export async function deleteTrainingJob(jobId: string): Promise<void> {
  await fetch(
    `${TL_ROOT}/jobs/delete/${encodeURIComponent(jobId)}?experimentId=${FINETUNE_EXPERIMENT}`,
    { headers: inferenceHeaders() }
  ).catch(() => {});
}

/** Single training job status (TL `/jobs/{id}`). */
export async function fetchTrainingJob(id: string): Promise<TrainingJob | null> {
  try {
    const res = await fetch(`${TL_ROOT}/jobs/${encodeURIComponent(id)}`, {
      headers: inferenceHeaders(),
    });
    if (!res.ok) return null;
    return normalizeJob((await res.json()) as TlJob);
  } catch {
    return null;
  }
}

