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
import { TL_ROOT } from "@/lib/inference";
import { tlFetch } from "@/lib/tl-fetch";
import {
  deleteOllamaModel,
  listOllamaModels,
  loadedOllamaModel,
  pullOllamaModel,
  unloadOllama,
} from "@/lib/ollama";

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
  /** The model currently resident in Ollama's VRAM, if any. */
  loaded: string | null;
  /** TL model registry (HF ids) — for training/eval context. */
  downloaded: CatalogModel[];
  recommended: CatalogModel[];
  fineTuned: FineTunedModel[];
  /** Ollama models pulled and ready to chat with (the serve/chat namespace). */
  servable: CatalogModel[];
  /** Suggested Ollama tags to pull that fit a small GPU. */
  ollamaRecommended: CatalogModel[];
};

/** Curated Ollama tags that fit a ~6–8 GB GPU (4-bit GGUF). */
const OLLAMA_RECOMMENDED: Array<{ tag: string; label: string; sizeMb: number }> = [
  { tag: "qwen2.5:0.5b", label: "Qwen2.5 0.5B", sizeMb: 398 },
  { tag: "llama3.2:1b", label: "Llama 3.2 1B", sizeMb: 1300 },
  { tag: "qwen2.5:1.5b", label: "Qwen2.5 1.5B", sizeMb: 986 },
  { tag: "gemma2:2b", label: "Gemma 2 2B", sizeMb: 1600 },
  { tag: "llama3.2:3b", label: "Llama 3.2 3B", sizeMb: 2000 },
  { tag: "phi3.5", label: "Phi 3.5 Mini", sizeMb: 2200 },
];

function ollamaToCatalog(m: { id: string; name: string; sizeMb: number | null }): CatalogModel {
  return {
    id: m.id,
    name: m.name,
    architecture: "GGUF",
    sizeMb: m.sizeMb,
    isGguf: true,
    downloaded: true,
  };
}

/** Ollama models pulled and ready to chat with, as CatalogModel rows. */
export async function fetchServable(): Promise<CatalogModel[]> {
  const models = await listOllamaModels();
  return models.map(ollamaToCatalog);
}

/** Recommended Ollama tags, flagged with whether they're already pulled. */
export function ollamaRecommendedWithStatus(servable: CatalogModel[]): CatalogModel[] {
  const have = new Set(servable.map((m) => m.id));
  return OLLAMA_RECOMMENDED.map((r) => ({
    id: r.tag,
    name: r.label,
    architecture: "GGUF",
    sizeMb: r.sizeMb,
    isGguf: true,
    downloaded: have.has(r.tag),
  }));
}

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
  const res = await tlFetch(`/model/list`);
  // Don't silently return [] on failure — that makes a TL outage or a bad/expired
  // INFERENCE_API_KEY (401/403) look like "you have no models". Throw so the caller
  // (a route that degrades to empty) logs the real cause.
  if (!res.ok) throw new Error(`TL /model/list ${res.status}`);
  const rows = (await res.json().catch(() => null)) as TlLocalModel[] | null;
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

/** Delete local models. Reports which ids succeeded vs failed (so callers don't
 * show a blanket success when TL rejected a delete). */
export async function deleteModels(
  ids: string[]
): Promise<{ deleted: string[]; failed: string[] }> {
  // Two namespaces: Ollama tags (served models, incl. fine-tunes) vs TL registry
  // ids. Delete each from the right place. Ids that are neither (e.g. a train job
  // id passed alongside its served tag) are treated as no-ops, not failures.
  const ollamaTags = new Set(
    (await listOllamaModels().catch(() => [])).map((m) => m.id.replace(/:latest$/, ""))
  );
  const results = await Promise.all(
    ids.filter(Boolean).map(async (id) => {
      const tag = id.replace(/:latest$/, "");
      if (ollamaTags.has(tag)) {
        return { id, ok: await deleteOllamaModel(tag) };
      }
      // TL registry ids look like "Org/Model"; anything else isn't a model.
      if (!id.includes("/")) return { id, ok: true };
      try {
        const res = await tlFetch(`/model/delete?model_id=${encodeURIComponent(id)}`);
        return { id, ok: res.ok };
      } catch {
        return { id, ok: false };
      }
    })
  );
  return {
    deleted: results.filter((r) => r.ok).map((r) => r.id),
    failed: results.filter((r) => !r.ok).map((r) => r.id),
  };
}

/** Fine-tuned adaptors for a base model (TL `/model/pefts`; body is a raw string). */
export async function fetchAdaptors(baseModelId: string): Promise<string[]> {
  try {
    const res = await tlFetch(`/model/pefts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(baseModelId),
    });
    if (!res.ok) return [];
    const list = (await res.json()) as unknown;
    return Array.isArray(list) ? (list as string[]) : [];
  } catch {
    return [];
  }
}

/**
 * Swap the loaded model: stop the current worker, then start the requested one
 * with the right loader (GGUF → llama.cpp with the local file; otherwise
 * fastchat by model id). Pass `adaptor` to load a fine-tuned LoRA on top of the
 * base model. Blocks until TL reports the worker is up. Returns the model id on
 * success, or throws with TL's error message.
 */
export async function loadModel(modelId: string): Promise<string> {
  // v0.40.0: serving is Ollama. "Loading" a model = making sure it's pulled;
  // Ollama then auto-loads it into VRAM on the first chat request. `modelId` is
  // an Ollama tag (e.g. "qwen2.5:0.5b"). LoRA adaptors aren't applied here —
  // fine-tunes are served by exporting to GGUF and importing as an Ollama model.
  await pullOllamaModel(modelId);
  return modelId;
}

/**
 * Unload the model from VRAM so nothing is held (undeploy / free the GPU).
 * Returns whether Ollama accepted it.
 */
export async function stopServing(): Promise<boolean> {
  return unloadOllama();
}

/**
 * Pull a model into Ollama (downloads if missing). `repo` is an Ollama tag.
 * Long-running for large models — Ollama streams the bytes. (`ggufFile` is a
 * legacy TL param, ignored: Ollama tags are self-contained.)
 */
export async function downloadModel(repo: string, _ggufFile?: string): Promise<void> {
  void _ggufFile;
  await pullOllamaModel(repo);
}

/** The model currently resident in Ollama's VRAM, if any. */
export async function fetchLoaded(): Promise<string | null> {
  return loadedOllamaModel();
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
