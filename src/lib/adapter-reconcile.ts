/**
 * Adapter reconciler (Phase 2): make the running vLLM match the desired-state
 * manifest. Additive by design — it LOADS every remembered adapter that isn't
 * live, but never unloads anything. That keeps it safe next to the launch-time
 * adapters (ask/learn/practice) it doesn't own: it can't nuke production.
 *
 * The headline use is self-healing: after a vLLM restart, runtime-attached
 * adapters are gone from `/v1/models` but still in the manifest — reconcile
 * re-attaches them. Callable on demand (a UI "Sync" button) or on page load.
 */
import { readManifest, type ManifestAdapter } from "@/lib/adapter-manifest-store";
import { listOpenAIModels, resolveEngine } from "@/lib/inference-engines";
import { loadLoraAdapter } from "@/lib/vllm-lora";

export type AdapterDrift = {
  /** vLLM is configured (has a base URL). */
  configured: boolean;
  /** Adapter names the manifest remembers. */
  remembered: string[];
  /** Remembered adapters missing from the live vLLM (need re-loading). */
  missing: ManifestAdapter[];
};

/** Compare the manifest (desired) with vLLM's live `/v1/models` (actual). */
export async function computeAdapterDrift(): Promise<AdapterDrift> {
  const engine = resolveEngine("vllm");
  if (!engine.configured) return { configured: false, remembered: [], missing: [] };
  const manifest = await readManifest();
  if (manifest.length === 0) return { configured: true, remembered: [], missing: [] };
  const live = await listOpenAIModels(engine.v1BaseUrl, engine.headers);
  const liveNames = new Set(live.map((m) => m.id));
  return {
    configured: true,
    remembered: manifest.map((a) => a.name),
    missing: manifest.filter((a) => !liveNames.has(a.name)),
  };
}

export type ReconcileResult = {
  configured: boolean;
  /** Manifest adapters already live (no action needed). */
  alreadyLoaded: number;
  /** Adapter names loaded by this run. */
  loaded: string[];
  /** Adapters that failed to load, with vLLM's message. */
  failed: { name: string; error: string }[];
};

/** Load every remembered-but-missing adapter into the running vLLM. */
export async function reconcileAdapters(): Promise<ReconcileResult> {
  const engine = resolveEngine("vllm");
  if (!engine.configured) return { configured: false, alreadyLoaded: 0, loaded: [], failed: [] };

  const { remembered, missing } = await computeAdapterDrift();
  const loaded: string[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const a of missing) {
    const res = await loadLoraAdapter(engine, a.name, a.path);
    if (res.ok) loaded.push(a.name);
    else failed.push({ name: a.name, error: res.message });
  }
  return { configured: true, alreadyLoaded: remembered.length - missing.length, loaded, failed };
}
