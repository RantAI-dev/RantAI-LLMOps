/**
 * Desired-state manifest of runtime-attached LoRA adapters, one per engine.
 *
 * The launch-time adapters (VLLM_LORA_MODULES / SGLANG_LORA_MODULES, e.g.
 * ask/learn/practice) are owned by the engine container and come back on their
 * own after a restart. This manifest remembers adapters ATTACHED from the UI at
 * runtime — which the engine forgets on restart — so the reconciler
 * (src/lib/adapter-reconcile) can re-load them.
 *
 * Stored server-side as JSON under `$RANTAI_DATA_DIR`: adapter-manifest.json for
 * vLLM (the original file) and adapter-manifest-sglang.json for SGLang.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

import type { LoraEngineId } from "@/lib/engine-lora";

const DATA_DIR = process.env.RANTAI_DATA_DIR ?? path.join(process.cwd(), ".rantai-data");
const fileFor = (engine: LoraEngineId) =>
  path.join(DATA_DIR, engine === "vllm" ? "adapter-manifest.json" : `adapter-manifest-${engine}.json`);

export type ManifestAdapter = { name: string; path: string };

export async function readManifest(engine: LoraEngineId = "vllm"): Promise<ManifestAdapter[]> {
  try {
    const raw = await fs.readFile(fileFor(engine), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (a): a is ManifestAdapter =>
        Boolean(a) &&
        typeof (a as ManifestAdapter).name === "string" &&
        typeof (a as ManifestAdapter).path === "string"
    );
  } catch {
    return [];
  }
}

async function writeManifest(engine: LoraEngineId, items: ManifestAdapter[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(fileFor(engine), JSON.stringify(items, null, 2), "utf8");
}

/** Remember an attached adapter (upsert by name — last path wins). */
export async function addToManifest(item: ManifestAdapter, engine: LoraEngineId = "vllm"): Promise<void> {
  const items = await readManifest(engine);
  const next = items.filter((a) => a.name !== item.name);
  next.push(item);
  await writeManifest(engine, next);
}

/** Forget a detached adapter by name. */
export async function removeFromManifest(name: string, engine: LoraEngineId = "vllm"): Promise<void> {
  const items = await readManifest(engine);
  const next = items.filter((a) => a.name !== name);
  if (next.length !== items.length) await writeManifest(engine, next);
}
