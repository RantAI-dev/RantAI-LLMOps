/**
 * Server-only helpers for the model picker (`/api/models/catalog|load|download`).
 *
 * The picker mirrors Transformer Lab's own model UX (Downloaded / Recommended /
 * Hub search), built entirely on TL's existing HTTP API — no new backend. All
 * calls use the BFF's permanent API key via {@link inferenceHeaders}, so the
 * browser never holds a TL token.
 *
 * Engine selection: TL loads a model through a *loader plugin*. GGUF models run
 * on `llama_cpp_server` (quantized, fits small GPUs); everything else (plain
 * safetensors) runs on `fastchat_server`. We pick the loader from the model's
 * architecture.
 */
import { INFERENCE_BASE_URL, inferenceHeaders } from "@/lib/inference";

/** TL base without the trailing `/v1` — the model/server routes live at the root. */
const TL_ROOT = INFERENCE_BASE_URL.replace(/\/v1$/, "");

export type CatalogModel = {
  /** TL model id (usually the HF repo, e.g. `Qwen/Qwen2.5-3B-Instruct-GGUF`). */
  id: string;
  /** Human label. */
  name: string;
  /** Model architecture as TL reports it (e.g. `GGUF`, `LlamaForCausalLM`). */
  architecture: string;
  /** Size in MB when known. */
  sizeMb: number | null;
  /** True for quantized GGUF models (loaded via llama.cpp). */
  isGguf: boolean;
  /** Already on disk? */
  downloaded: boolean;
  /** Source HF repo, for download/search. */
  hfRepo?: string;
  /** For a Recommended GGUF: the specific quant file to download. */
  ggufFile?: string;
  /** Absolute on-disk path (the .gguf file for GGUF, the dir otherwise). */
  localPath?: string;
};

/**
 * A fine-tuned model = the merged ("fused") output of a training run. TL prefixes
 * fused models with `TransformerLab/`. To chat with one it must be exported to
 * GGUF (TL's safetensors inference path is buggy); `ready` means that GGUF
 * exists and `loadModelId` points at it.
 */
export type FineTunedModel = {
  /** Display name (the training/adaptor name). */
  name: string;
  baseModelName: string;
  /** The merged safetensors model id — the export input. */
  fusedModelId: string;
  /** Whether a GGUF export exists (and can be loaded for chat). */
  ready: boolean;
  /** The GGUF model id to load, when ready. */
  loadModelId: string | null;
};

export type ModelCatalog = {
  /** The model currently loaded into VRAM (served by `/v1/models`), if any. */
  loaded: string | null;
  downloaded: CatalogModel[];
  recommended: CatalogModel[];
  fineTuned: FineTunedModel[];
};

/** Loader plugin + flag for a given architecture. */
export function loaderForArchitecture(architecture: string): {
  engine: "llama_cpp_server" | "fastchat_server";
  isGguf: boolean;
} {
  const isGguf = (architecture || "").toUpperCase() === "GGUF";
  return { engine: isGguf ? "llama_cpp_server" : "fastchat_server", isGguf };
}

/**
 * Curated "Recommended" models that comfortably fit a ~6–8 GB GPU as 4-bit
 * GGUF. These mirror Unsloth/TL's recommended picks for modest hardware. The
 * full 200+ gallery stays reachable through Hub search.
 */
export const RECOMMENDED: CatalogModel[] = [
  {
    id: "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
    name: "Qwen2.5 1.5B Instruct",
    architecture: "GGUF",
    sizeMb: 1120,
    isGguf: true,
    downloaded: false,
    hfRepo: "Qwen/Qwen2.5-1.5B-Instruct-GGUF",
    ggufFile: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
  },
  {
    id: "Qwen/Qwen2.5-3B-Instruct-GGUF",
    name: "Qwen2.5 3B Instruct",
    architecture: "GGUF",
    sizeMb: 2010,
    isGguf: true,
    downloaded: false,
    hfRepo: "Qwen/Qwen2.5-3B-Instruct-GGUF",
    ggufFile: "qwen2.5-3b-instruct-q4_k_m.gguf",
  },
  {
    id: "bartowski/Llama-3.2-3B-Instruct-GGUF",
    name: "Llama 3.2 3B Instruct",
    architecture: "GGUF",
    sizeMb: 2020,
    isGguf: true,
    downloaded: false,
    hfRepo: "bartowski/Llama-3.2-3B-Instruct-GGUF",
    ggufFile: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
  },
  {
    id: "bartowski/gemma-2-2b-it-GGUF",
    name: "Gemma 2 2B Instruct",
    architecture: "GGUF",
    sizeMb: 1710,
    isGguf: true,
    downloaded: false,
    hfRepo: "bartowski/gemma-2-2b-it-GGUF",
    ggufFile: "gemma-2-2b-it-Q4_K_M.gguf",
  },
];

type TlLocalModel = {
  model_id?: string;
  name?: string;
  local_path?: string;
  stored_in_filesystem?: boolean;
  json_data?: {
    uniqueID?: string;
    name?: string;
    architecture?: string;
    size_of_model_in_mb?: number | null;
    huggingface_repo?: string;
  };
};

/** Models already downloaded to disk (TL `/model/list`). */
export async function fetchDownloaded(): Promise<CatalogModel[]> {
  const res = await fetch(`${TL_ROOT}/model/list`, { headers: inferenceHeaders() });
  if (!res.ok) return [];
  const rows = (await res.json()) as TlLocalModel[];
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const j = r.json_data ?? {};
    const architecture = j.architecture ?? "";
    return {
      id: r.model_id ?? j.uniqueID ?? "",
      name: j.name ?? r.model_id ?? "",
      architecture,
      sizeMb: j.size_of_model_in_mb ?? null,
      isGguf: loaderForArchitecture(architecture).isGguf,
      downloaded: true,
      hfRepo: j.huggingface_repo,
      localPath: r.local_path,
    } satisfies CatalogModel;
  });
}

/** Delete local models (best-effort, ignores ones already gone). */
export async function deleteModels(ids: string[]): Promise<void> {
  await Promise.all(
    ids
      .filter(Boolean)
      .map((id) =>
        fetch(`${TL_ROOT}/model/delete?model_id=${encodeURIComponent(id)}`, {
          headers: inferenceHeaders(),
        }).catch(() => {})
      )
  );
}

/** Fine-tuned adaptors for a base model (TL `/model/pefts`; body is a raw string). */
export async function fetchAdaptors(baseModelId: string): Promise<string[]> {
  try {
    const res = await fetch(`${TL_ROOT}/model/pefts`, {
      method: "POST",
      headers: inferenceHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(baseModelId),
    });
    if (!res.ok) return [];
    const list = (await res.json()) as unknown;
    return Array.isArray(list) ? (list as string[]) : [];
  } catch {
    return [];
  }
}

const FUSED_PREFIX = "TransformerLab/";

/**
 * Fine-tuned models = the merged ("fused") training outputs TL stores under the
 * `TransformerLab/` prefix. Each is matched to its GGUF export (same prefix,
 * GGUF arch, id starting with the fused id) to decide `ready` vs needs-export.
 */
export function fetchFineTuned(downloaded: CatalogModel[]): FineTunedModel[] {
  const fused = downloaded.filter((m) => m.id.startsWith(FUSED_PREFIX) && !m.isGguf);
  const ggufExports = downloaded.filter((m) => m.id.startsWith(FUSED_PREFIX) && m.isGguf);

  return fused.map((m) => {
    const stripped = m.id.slice(FUSED_PREFIX.length); // e.g. "Qwen2.5-0.5B-Instruct_my-run"
    const sep = stripped.indexOf("_");
    const baseModelName = sep >= 0 ? stripped.slice(0, sep) : stripped;
    const name = sep >= 0 ? stripped.slice(sep + 1) : stripped;
    const gguf = ggufExports.find((g) => g.id.startsWith(`${m.id}-`));
    return {
      name,
      baseModelName,
      fusedModelId: m.id,
      ready: Boolean(gguf),
      loadModelId: gguf?.id ?? null,
    } satisfies FineTunedModel;
  });
}

/**
 * Swap the loaded model: stop the current worker, then start the requested one
 * with the right loader (GGUF → llama.cpp with the local file; otherwise
 * fastchat by model id). Pass `adaptor` to load a fine-tuned LoRA on top of the
 * base model. Blocks until TL reports the worker is up. Returns the model id on
 * success, or throws with TL's error message.
 */
export async function loadModel(modelId: string, adaptor?: string): Promise<string> {
  const downloaded = await fetchDownloaded();
  const model = downloaded.find((m) => m.id === modelId);
  if (!model) throw new Error(`Model "${modelId}" is not downloaded`);

  const { engine, isGguf } = loaderForArchitecture(model.architecture);
  const inferenceParams = JSON.stringify(
    isGguf
      ? { inferenceEngine: engine, n_gpu_layers: "auto" }
      : { inferenceEngine: engine }
  );

  // Free VRAM first — a 6 GB GPU fits one model at a time. Best-effort.
  await fetch(`${TL_ROOT}/server/worker_stop`, { headers: inferenceHeaders() }).catch(() => {});

  const params = new URLSearchParams({
    model_name: modelId,
    model_architecture: model.architecture,
    inference_engine: engine,
    inference_params: inferenceParams,
  });
  if (adaptor) params.set("adaptor", adaptor);

  // Resolve the on-disk path. For most models TL gives us `local_path` (the
  // .gguf file, or the model dir). But TL fails to populate it for GGUFs it
  // *exported itself* (fine-tuned models, prefixed `TransformerLab/`), so we
  // reconstruct it: TL stores them at <models>/<id>/<id>. HF-hub models have no
  // local path and resolve by id.
  let filename = model.localPath;
  if (!filename && isGguf && model.id.startsWith("TransformerLab/")) {
    const ref = downloaded.find((m) => m.localPath?.includes("/models/"));
    if (ref?.localPath) {
      const modelsDir = ref.localPath.replace(/\/models\/.*$/, "/models");
      const base = model.id.slice("TransformerLab/".length);
      filename = `${modelsDir}/${base}/${base}`;
    }
  }
  if (filename) params.set("model_filename", filename);

  const res = await fetch(`${TL_ROOT}/server/worker_start?${params.toString()}`, {
    headers: inferenceHeaders(),
  });
  const data = (await res.json().catch(() => ({}))) as { status?: string; message?: string };
  if (!res.ok || data.status === "error") {
    throw new Error(data.message || `Failed to load model (${res.status})`);
  }
  return modelId;
}

/**
 * Download a model into TL. GGUF picks a specific quant file; a plain HF repo
 * downloads the whole model. Long-running — TL streams the bytes server-side.
 */
export async function downloadModel(repo: string, ggufFile?: string): Promise<void> {
  const url = ggufFile
    ? `${TL_ROOT}/model/download_gguf_file?model=${encodeURIComponent(repo)}&filename=${encodeURIComponent(ggufFile)}`
    : `${TL_ROOT}/model/download_from_huggingface?model=${encodeURIComponent(repo)}`;
  const res = await fetch(url, { headers: inferenceHeaders() });
  const data = (await res.json().catch(() => ({}))) as { status?: string; message?: string };
  if (!res.ok || data.status === "error") {
    throw new Error(data.message || `Download failed (${res.status})`);
  }
}

/** The model currently loaded into VRAM (TL OpenAI `/v1/models`). */
export async function fetchLoaded(): Promise<string | null> {
  const res = await fetch(`${INFERENCE_BASE_URL}/models`, { headers: inferenceHeaders() });
  if (!res.ok) return null;
  const data = (await res.json()) as { data?: Array<{ id?: string }> };
  return data?.data?.[0]?.id ?? null;
}

/** Recommended list, flagged with what's already downloaded. */
export function recommendedWithStatus(downloaded: CatalogModel[]): CatalogModel[] {
  const have = new Set(downloaded.map((m) => m.id));
  const haveRepos = new Set(downloaded.map((m) => m.hfRepo).filter(Boolean));
  return RECOMMENDED.map((m) => ({
    ...m,
    downloaded: have.has(m.id) || (m.hfRepo ? haveRepos.has(m.hfRepo) : false),
  }));
}

export { TL_ROOT };
