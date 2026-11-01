/**
 * Server-only registry of inference engines.
 *
 * v0.40.0 delegates serving to an external OpenAI-compatible engine. Until now
 * that was hardwired to Ollama in every route. This module makes the engine a
 * choice: Ollama (GGUF, serves every pulled model, run on the host) and vLLM
 * (safetensors, full precision). vLLM serves one base model, and — when launched
 * with `--enable-lora` / VLLM_LORA_MODULES — additional LoRA adapters the client
 * picks per request via the `model` field (base / asklearn / practice). Both
 * engines speak `/v1`, so once a route resolves the engine's base URL + headers
 * the rest of the proxy is identical, and each served name (base or adapter) is
 * just another entry in `/v1/models`.
 *
 * vLLM is optional: it is only "configured" when VLLM_BASE_URL is set. Fase 0
 * proved it runs on the GB10; a permanent instance (and that env var) lands in
 * the deployment work. Until then it shows as configured=false, not an error.
 *
 * SGLang (SGLANG_BASE_URL) is a third, opt-in engine shaped like vLLM: one base
 * plus LoRA adapters. Its one difference matters: it selects an adapter with
 * `model: "<base>:<adapter>"`, and it answers ANY other name — a bare adapter
 * name, a typo, an unloaded adapter — with the base model and HTTP 200. So
 * requests to it go through `sglangRequestModel`, which maps the names clients
 * already use (base / ask / …) and refuses the rest.
 */
import { INFERENCE_MODEL } from "@/lib/inference";
import { OLLAMA_V1, listOllamaModels, loadedOllamaModel, ollamaUp } from "@/lib/ollama";

export type EngineId = "ollama" | "vllm" | "sglang";

/** A model an engine is currently serving. `root` is what vLLM's /v1/models
 *  exposes behind a served-name alias: for the base it's the real model
 *  (e.g. aisingapore/Gemma-SEA-LION-v4-4B-VL), for a LoRA adapter its on-disk dir.
 *  `parent` is set by SGLang on LoRA adapters: the served name of their base. */
export type ServedModel = { id: string; name: string; isGguf: boolean; root?: string; parent?: string };

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
  /** The REAL base model behind the served-name alias (vLLM `root` of models[0]),
   *  e.g. aisingapore/Gemma-SEA-LION-v4-4B-VL — so the UI can show which model is
   *  actually loaded, not just the alias. Null when unknown/not applicable. */
  baseModel: string | null;
  /** Models this engine can serve. */
  models: ServedModel[];
};

/** vLLM is opt-in: no base URL → engine listed but marked not configured. */
const VLLM_BASE_URL = (process.env.VLLM_BASE_URL ?? "").replace(/\/$/, "");
/** vLLM runs without auth by default; set only if launched with `--api-key`. */
const VLLM_API_KEY = process.env.VLLM_API_KEY ?? "";
/** SGLang is opt-in the same way; its key only if launched with `--api-key`. */
const SGLANG_BASE_URL = (process.env.SGLANG_BASE_URL ?? "").replace(/\/$/, "");
const SGLANG_API_KEY = process.env.SGLANG_API_KEY ?? "";

/** Auth headers for an engine's `/v1` (empty for a keyless engine). */
export function engineHeaders(id: EngineId): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = id === "vllm" ? VLLM_API_KEY : id === "sglang" ? SGLANG_API_KEY : "";
  if (key) headers.Authorization = `Bearer ${key}`;
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
    const data = (await res.json()) as { data?: Array<{ id?: string; root?: string; parent?: string | null }> };
    return (data.data ?? [])
      .filter((m) => m.id)
      .map((m) => ({
        id: m.id as string,
        name: m.id as string,
        isGguf: false,
        root: m.root,
        ...(m.parent ? { parent: m.parent } : {}),
      }));
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
    baseModel: loaded, // Ollama's served id is already the real model name.
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
      baseModel: null,
      models: [],
    };
  }
  const models = await listOpenAIModels(VLLM_BASE_URL, engineHeaders("vllm"));
  return {
    id: "vllm",
    label: "vLLM",
    v1BaseUrl: VLLM_BASE_URL,
    configured: true,
    // `/v1/models` lists the base first, then any LoRA adapters. Reachability ==
    // at least the base being listed; `loaded` reports the base (models[0]).
    available: models.length > 0,
    loaded: models[0]?.id ?? null,
    // The base's `root` is the REAL model behind the served-name alias.
    baseModel: models[0]?.root ?? null,
    models,
  };
}

async function sglangInfo(): Promise<EngineInfo> {
  const off = { id: "sglang" as const, label: "SGLang", v1BaseUrl: SGLANG_BASE_URL, loaded: null, baseModel: null, models: [] };
  if (!SGLANG_BASE_URL) return { ...off, configured: false, available: false };
  const models = await listOpenAIModels(SGLANG_BASE_URL, engineHeaders("sglang"));
  const base = models.find((m) => !m.parent) ?? models[0];
  // SGLang's /v1/models reports the served name as the base's root, so the real
  // model comes from its native /model_info.
  let baseModel: string | null = null;
  if (base) {
    try {
      const res = await fetch(`${SGLANG_BASE_URL.replace(/\/v1$/, "")}/model_info`, {
        headers: engineHeaders("sglang"),
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) baseModel = ((await res.json()) as { model_path?: string }).model_path ?? null;
    } catch {
      /* the alias is still shown */
    }
  }
  return {
    ...off,
    configured: true,
    available: models.length > 0,
    loaded: base?.id ?? null,
    baseModel,
    // Base first, like vLLM, so the Serve and Playground lists read the same.
    models: base ? [base, ...models.filter((m) => m !== base)] : [],
  };
}

/**
 * The name to send to SGLang for a client's model pick, or null when SGLang does
 * not serve it. The base keeps its served name; an adapter becomes
 * `<base>:<adapter>`; an already-qualified `<base>:<adapter>` passes through when
 * that adapter is loaded. Anything else is null, because SGLang itself would
 * quietly answer it with the base model.
 */
export function sglangRequestModel(model: string, served: ServedModel[]): string | null {
  const base = served.find((m) => !m.parent);
  if (!base) return null;
  if (model === base.id) return base.id;
  const adapter = model.startsWith(`${base.id}:`) ? model.slice(base.id.length + 1) : model;
  return served.some((m) => m.parent === base.id && m.id === adapter) ? `${base.id}:${adapter}` : null;
}

/** Every engine, with live availability. Order = display order (default first). */
export async function listEngines(): Promise<EngineInfo[]> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") return (await import("@/lib/demo/stores")).demoEngines();
  return Promise.all([ollamaInfo(), vllmInfo(), sglangInfo()]);
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
  const engineId: EngineId = id === "vllm" || id === "sglang" ? id : DEFAULT_ENGINE;
  const v1BaseUrl = engineId === "vllm" ? VLLM_BASE_URL : engineId === "sglang" ? SGLANG_BASE_URL : OLLAMA_V1;
  return {
    id: engineId,
    label: engineId === "vllm" ? "vLLM" : engineId === "sglang" ? "SGLang" : "Ollama",
    v1BaseUrl,
    configured: engineId === "ollama" ? true : Boolean(v1BaseUrl),
    headers: engineHeaders(engineId),
  };
}

/** The env var that points the app at an engine, for "not configured" messages. */
export function engineUrlVar(id: EngineId): string {
  return id === "vllm" ? "VLLM_BASE_URL" : id === "sglang" ? "SGLANG_BASE_URL" : "OLLAMA_BASE_URL";
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
    const loaded = await loadedOllamaModel();
    if (loaded) return loaded;
    // INFERENCE_MODEL is a deployment-time guess and can name a model that was
    // never pulled — that used to surface as a bare 404 the moment anyone opened
    // Interact without picking a model. Only trust it when Ollama really has it;
    // otherwise fall back to whatever IS installed.
    // Only models that can hold a conversation are candidates. Ollama serves
    // embedding models (bge-m3, all-minilm) from the same list, and picking one
    // answers "does not support chat" — the same dead end as naming a model that
    // was never pulled. Treat an empty capability list as chat-capable, since
    // older Ollama builds do not report it at all.
    const canChat = (m: { capabilities: string[] }) =>
      m.capabilities.length === 0 || m.capabilities.some((c) => c !== "embedding");
    const installed = (await listOllamaModels()).filter(canChat);
    if (INFERENCE_MODEL && installed.some((m) => m.id === INFERENCE_MODEL)) return INFERENCE_MODEL;
    return installed[0]?.id || INFERENCE_MODEL || "default";
  }
  const served = await listOpenAIModels(engine.v1BaseUrl, engine.headers);
  return (served.find((m) => !m.parent) ?? served[0])?.id || INFERENCE_MODEL || "default";
}

/**
 * The model name to put on the wire for a resolved chat model. Only SGLang
 * rewrites (see `sglangRequestModel`); `error` is set when it does not serve the
 * name, so the caller can refuse instead of getting a silent base-model reply.
 */
export async function engineRequestModel(
  engine: ResolvedEngine,
  model: string
): Promise<{ model: string; error?: string }> {
  if (engine.id !== "sglang") return { model };
  const served = await listOpenAIModels(engine.v1BaseUrl, engine.headers);
  const mapped = sglangRequestModel(model, served);
  if (mapped) return { model: mapped };
  const names = served.map((m) => m.id).join(", ") || "none";
  return { model, error: `SGLang does not serve "${model}" (serving: ${names}).` };
}
