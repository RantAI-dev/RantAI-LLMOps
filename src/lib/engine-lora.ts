/**
 * Runtime LoRA attach/detach for the engines that serve one base + adapters:
 * vLLM and SGLang. Used by /api/adapters and the reconciler.
 *
 * vLLM: `/v1/load_lora_adapter` with the adapter dir as trained (src/lib/vllm-lora).
 *
 * SGLang: `/load_lora_adapter` at the server root, answering JSON
 * `{success, error_message}`. It refuses Unsloth adapters as saved, because their
 * `target_modules` is a regex string. The managed SGLang container therefore runs
 * a small helper next to the server (SGLANG_LORA_HELPER in
 * serve-sglang-container.ts, internal port 30001): `POST /prepare` builds a copy
 * the server accepts (symlinks to the trained files + a config that lists the
 * modules) and returns its path; `GET /adapters` lists the trained adapters on
 * the TL data volume. The trained adapter is never modified (vLLM serves the
 * same files). Without the helper, the trained dir is loaded as is.
 */
import type { ResolvedEngine } from "@/lib/inference-engines";
import { loadLoraAdapter, unloadLoraAdapter, type LoraResult } from "@/lib/vllm-lora";

export type LoraEngineId = "vllm" | "sglang";

export function isLoraEngine(v: unknown): v is LoraEngineId {
  return v === "vllm" || v === "sglang";
}

export const ENGINE_LABEL: Record<LoraEngineId, string> = { vllm: "vLLM", sglang: "SGLang" };

/** SGLang's admin endpoints live at the server root, not under /v1. */
export function sglangRoot(v1BaseUrl: string): string {
  return v1BaseUrl.replace(/\/v1\/?$/, "");
}

/** The adapter helper in the SGLang container: SGLANG_LORA_HELPER_URL, else port 30001 on the same host. */
export function sglangHelperUrl(v1BaseUrl: string): string {
  const fromEnv = (process.env.SGLANG_LORA_HELPER_URL ?? "").replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  try {
    const u = new URL(sglangRoot(v1BaseUrl));
    u.port = "30001";
    return u.origin;
  } catch {
    return "";
  }
}

/** The dir SGLang should load for this adapter: a prepared copy when needed. */
export async function prepareSglangAdapter(v1BaseUrl: string, name: string, path: string): Promise<string> {
  const helper = sglangHelperUrl(v1BaseUrl);
  if (!helper) throw new Error("no adapter helper URL");
  const res = await fetch(`${helper}/prepare`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, path }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
  if (!res.ok || !body.path) throw new Error(body.error || `adapter helper returned ${res.status}`);
  return body.path;
}

export type DiskAdapter = { jobId: string; path: string; base: string };

/** Trained adapters on the TL data volume, as the SGLang container sees them. Empty without the helper. */
export async function listSglangDiskAdapters(v1BaseUrl: string): Promise<DiskAdapter[]> {
  const helper = sglangHelperUrl(v1BaseUrl);
  if (!helper) return [];
  try {
    const res = await fetch(`${helper}/adapters`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const body = (await res.json()) as { adapters?: Array<{ path?: string; base?: string }> };
    return (body.adapters ?? [])
      .filter((a): a is { path: string; base?: string } => typeof a.path === "string")
      .map((a) => ({ jobId: /jobs\/([^/]+)\/models\//.exec(a.path)?.[1] ?? a.path, path: a.path, base: a.base ?? "" }));
  } catch {
    return [];
  }
}

async function callSglang(engine: ResolvedEngine, path: string, payload: Record<string, string>): Promise<LoraResult> {
  try {
    const res = await fetch(`${sglangRoot(engine.v1BaseUrl)}${path}`, {
      method: "POST",
      headers: engine.headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    let body: { success?: boolean; error_message?: string | null } = {};
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      /* not JSON: report the raw text */
    }
    if (!res.ok || body.success === false) {
      return { ok: false, status: res.status, message: body.error_message || text.trim() || `SGLang returned ${res.status}` };
    }
    return { ok: true, status: res.status, message: "ok" };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Request to SGLang failed.";
    return { ok: false, status: 0, message: `Could not reach SGLang: ${detail}` };
  }
}

/** Attach an adapter (name + trained dir) to a running engine. */
export async function attachAdapter(
  id: LoraEngineId,
  engine: ResolvedEngine,
  name: string,
  path: string
): Promise<LoraResult> {
  if (id === "vllm") return loadLoraAdapter(engine, name, path);
  let loadPath = path;
  let prepError = "";
  try {
    loadPath = await prepareSglangAdapter(engine.v1BaseUrl, name, path);
  } catch (err) {
    // No helper (an SGLang not started by LLMOps): fine unless Unsloth saved a regex target_modules.
    prepError = err instanceof Error ? err.message : String(err);
  }
  const res = await callSglang(engine, "/load_lora_adapter", { lora_name: name, lora_path: loadPath });
  if (!res.ok && prepError) res.message += ` (the adapter helper on port 30001 was not usable: ${prepError})`;
  return res;
}

/** Detach an adapter by name from a running engine. */
export function detachAdapter(id: LoraEngineId, engine: ResolvedEngine, name: string): Promise<LoraResult> {
  if (id === "vllm") return unloadLoraAdapter(engine, name);
  return callSglang(engine, "/unload_lora_adapter", { lora_name: name });
}
