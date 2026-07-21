/**
 * Server-only registry of inference engines.
 *
 * v0.40.0 delegates serving to an external OpenAI-compatible engine. Until now
 * that was hardwired to Ollama in every route. This module makes the engine a
 * choice: Ollama (GGUF, serves every pulled model, run on the host) and vLLM
 * (safetensors, serves ONE model launched at container start, uses the GB10's
 * full precision). Both speak `/v1`, so once a route resolves the engine's base
 * URL + headers the rest of the proxy is identical.
 *
 * vLLM is optional: it is only "configured" when VLLM_BASE_URL is set. Fase 0
 * proved it runs on the GB10; a permanent instance (and that env var) lands in
 * the deployment work. Until then it shows as configured=false, not an error.
 */
import { INFERENCE_MODEL } from "@/lib/inference";
import { OLLAMA_V1, listOllamaModels, loadedOllamaModel, ollamaUp } from "@/lib/ollama";

export type EngineId = "ollama" | "vllm";

/** A model an engine is currently serving. */
export type ServedModel = { id: string; name: string; isGguf: boolean };

/** What an engine can report about itself for the Serve UI. */
export type EngineInfo = {
  id: EngineId;
  label: string;
  /** OpenAI-compatible base, e.g. http://host:8001/v1. "" when not configured. */
  v1BaseUrl: string;
  /** Has a base URL at all (vLLM is opt-in via env). */
  configured: boolean;
  /** Reachable right now. */
  available: boolean;
  /** The hot / served model, if the engine reports one. */
  loaded: string | null;
  /** Models this engine can serve. */
  models: ServedModel[];
};

/** vLLM is opt-in: no base URL → engine listed but marked not configured. */
const VLLM_BASE_URL = (process.env.VLLM_BASE_URL ?? "").replace(/\/$/, "");
/** vLLM runs without auth by default; set only if launched with `--api-key`. */
const VLLM_API_KEY = process.env.VLLM_API_KEY ?? "";

/** Auth headers for an engine's `/v1` (empty for a keyless engine). */
export function engineHeaders(id: EngineId): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (id === "vllm" && VLLM_API_KEY) headers.Authorization = `Bearer ${VLLM_API_KEY}`;
  return headers;
}

/**
 * List models from any OpenAI-compatible `/v1/models`. Used for vLLM (and as a
 * generic fallback); Ollama is read through its richer native `/api/tags`.
 */
export async function listOpenAIModels(
  v1BaseUrl: string,
  headers: Record<string, string> = {}
): Promise<ServedModel[]> {
  if (!v1BaseUrl) return [];
  try {
    const res = await fetch(`${v1BaseUrl}/models`, { headers, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    return (data.data ?? [])
      .filter((m) => m.id)
      .map((m) => ({ id: m.id as string, name: m.id as string, isGguf: false }));
  } catch {
    return [];
  }
}

async function ollamaInfo(): Promise<EngineInfo> {
  const [available, models, loaded] = await Promise.all([
    ollamaUp(),
    listOllamaModels(),
    loadedOllamaModel(),
  ]);
  return {
    id: "ollama",
    label: "Ollama",
    v1BaseUrl: OLLAMA_V1,
    configured: true, // Ollama is the always-present default engine.
    available,
    loaded,
    models: models.map((m) => ({ id: m.id, name: m.name, isGguf: true })),
  };
}

async function vllmInfo(): Promise<EngineInfo> {
  if (!VLLM_BASE_URL) {
    return {
      id: "vllm",
      label: "vLLM",
      v1BaseUrl: "",
      configured: false,
      available: false,
      loaded: null,
      models: [],
    };
  }
  const models = await listOpenAIModels(VLLM_BASE_URL, engineHeaders("vllm"));
  return {
    id: "vllm",
    label: "vLLM",
    v1BaseUrl: VLLM_BASE_URL,
    configured: true,
    // vLLM serves exactly one model; reachability == that model being listed.
    available: models.length > 0,
    loaded: models[0]?.id ?? null,
    models,
  };
}

/** Every engine, with live availability. Order = display order (default first). */
export async function listEngines(): Promise<EngineInfo[]> {
  return Promise.all([ollamaInfo(), vllmInfo()]);
}

/** The engine used when the client names none. */
export const DEFAULT_ENGINE: EngineId = "ollama";

export type ResolvedEngine = {
  id: EngineId;
  label: string;
  v1BaseUrl: string;
  configured: boolean;
  headers: Record<string, string>;
};

/**
 * Resolve a client-supplied engine id to what the chat proxy needs. Unknown or
 * missing → the default. `configured` is false when the engine has no base URL
 * (vLLM before deployment) — the caller should surface that instead of a
 * confusing connection error.
 */
export function resolveEngine(id?: string): ResolvedEngine {
  const engineId: EngineId = id === "vllm" ? "vllm" : DEFAULT_ENGINE;
  const v1BaseUrl = engineId === "vllm" ? VLLM_BASE_URL : OLLAMA_V1;
  return {
    id: engineId,
    label: engineId === "vllm" ? "vLLM" : "Ollama",
    v1BaseUrl,
    configured: engineId === "vllm" ? Boolean(VLLM_BASE_URL) : true,
    headers: engineHeaders(engineId),
  };
}

/**
 * The model to send to an engine for a chat request.
 *
 * Ollama serves every pulled model, so the client's pick wins, falling back to
 * whatever is hot in VRAM. vLLM serves a single model fixed at launch, so an
 * absent pick resolves to that one served model. INFERENCE_MODEL is the last
 * resort for either.
 */
export async function resolveChatModel(engine: ResolvedEngine, bodyModel?: string): Promise<string> {
  if (bodyModel) return bodyModel;
  if (engine.id === "ollama") {
    return (await loadedOllamaModel()) || INFERENCE_MODEL || "default";
  }
  const served = await listOpenAIModels(engine.v1BaseUrl, engine.headers);
  return served[0]?.id || INFERENCE_MODEL || "default";
}
