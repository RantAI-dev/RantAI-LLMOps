import { tlToRegistryModel } from "@/modules/model-registry/lib/from-tl";
import type { RegistryModel } from "@/modules/model-registry/types";

/**
 * The data seam for the Model Registry.
 *
 * Both `seedModels()` and `fetchModels()` reflect REAL state — no mock models.
 * The registry lists the models actually resident in Ollama (the `servable`
 * catalog list, which includes served fine-tunes), via our `/api/models/catalog`
 * BFF (server-side permanent key, works regardless of the app login). The
 * deployment / usage / evaluation analytics in the detail drawer have no backend
 * yet, so they stay as honest zeroed placeholders (not fabricated numbers).
 */

/** Empty until the real list loads — we never seed fake models. */
export function seedModels(): RegistryModel[] {
  return [];
}

type CatalogResponse = {
  servable?: Array<{
    id: string;
    name: string;
    architecture: string;
    sizeMb: number | null;
    isGguf: boolean;
    downloaded: boolean;
    hfRepo?: string;
    localPath?: string;
  }>;
};

/** Async load — the real Ollama-resident models via the catalog BFF. */
export async function fetchModels(): Promise<RegistryModel[]> {
  const res = await fetch("/api/models/catalog", { cache: "no-store" });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const data = (await res.json()) as CatalogResponse;
  const now = new Date().toISOString();
  return (data.servable ?? []).map((m) => tlToRegistryModel(m, now));
}
