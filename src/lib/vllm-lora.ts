/**
 * vLLM runtime LoRA calls, shared by the adapter route and the reconciler.
 *
 * vLLM exposes a dynamic-LoRA API (`/v1/load_lora_adapter`,
 * `/v1/unload_lora_adapter`) when launched with `--enable-lora` and
 * VLLM_ALLOW_RUNTIME_LORA_UPDATING=True. These helpers wrap those two calls plus
 * the input guards, so both the API route (user-driven attach/detach) and the
 * Phase-2 reconciler (self-healing) go through one implementation.
 */
import type { ResolvedEngine } from "@/lib/inference-engines";

// vLLM's dynamic-LoRA endpoints live under the same /v1 base as chat/models.
const LOAD_PATH = "/load_lora_adapter";
const UNLOAD_PATH = "/unload_lora_adapter";

/** Adapter name = the `model` a client routes by. Keep it id/URL-safe. */
export const ADAPTER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** The adapter dir must be one vLLM can read: under the mounted TL data, no traversal. */
export function isSafeAdapterPath(p: string): boolean {
  return p.startsWith("/root/.transformerlab/") && !p.includes("..") && !/[\s;&|`$()<>]/.test(p);
}

export type LoraResult = { ok: boolean; status: number; message: string };

/** One call to a vLLM dynamic-LoRA endpoint (responses are plain text, not JSON). */
async function callVllm(
  engine: ResolvedEngine,
  path: string,
  payload: Record<string, string>
): Promise<LoraResult> {
  try {
    const res = await fetch(`${engine.v1BaseUrl}${path}`, {
      method: "POST",
      headers: engine.headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    const text = (await res.text()).trim();
    if (!res.ok) {
      const hint =
        res.status === 404
          ? " (vLLM must run with VLLM_ALLOW_RUNTIME_LORA_UPDATING=True to allow runtime changes)"
          : "";
      return { ok: false, status: res.status, message: `${text || `vLLM returned ${res.status}`}${hint}` };
    }
    return { ok: true, status: res.status, message: text || "ok" };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Request to vLLM failed.";
    return { ok: false, status: 0, message: `Could not reach vLLM: ${detail}` };
  }
}

/** Hot-attach a LoRA adapter (name + on-disk dir) to the running vLLM. */
export function loadLoraAdapter(engine: ResolvedEngine, name: string, path: string): Promise<LoraResult> {
  return callVllm(engine, LOAD_PATH, { lora_name: name, lora_path: path });
}

/** Hot-detach a LoRA adapter by name from the running vLLM. */
export function unloadLoraAdapter(engine: ResolvedEngine, name: string): Promise<LoraResult> {
  return callVllm(engine, UNLOAD_PATH, { lora_name: name });
}
