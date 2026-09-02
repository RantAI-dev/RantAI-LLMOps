/**
 * Desired-state manifest of runtime-attached LoRA adapters (Phase 2).
 *
 * The launch-time adapters (VLLM_LORA_MODULES, e.g. ask/learn/practice) are owned
 * by the vLLM container and come back on their own after a restart. This manifest
 * remembers adapters ATTACHED from the UI at runtime — which vLLM forgets on
 * restart — so the reconciler (src/lib/adapter-reconcile) can re-load them. It is
 * the single source of truth for "adapters the user wants kept loaded".
 *
 * Stored server-side as JSON under `$RANTAI_DATA_DIR`, consistent with the
 * gateway / vLLM-deployment stores.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.RANTAI_DATA_DIR ?? path.join(process.cwd(), ".rantai-data");
const FILE = path.join(DATA_DIR, "adapter-manifest.json");

export type ManifestAdapter = { name: string; path: string };

export async function readManifest(): Promise<ManifestAdapter[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
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

async function writeManifest(items: ManifestAdapter[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(items, null, 2), "utf8");
}

/** Remember an attached adapter (upsert by name — last path wins). */
export async function addToManifest(item: ManifestAdapter): Promise<void> {
  const items = await readManifest();
  const next = items.filter((a) => a.name !== item.name);
  next.push(item);
  await writeManifest(next);
}

/** Forget a detached adapter by name. */
export async function removeFromManifest(name: string): Promise<void> {
  const items = await readManifest();
  const next = items.filter((a) => a.name !== name);
  if (next.length !== items.length) await writeManifest(next);
}
