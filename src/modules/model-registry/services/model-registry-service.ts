import { initialModels } from "@/modules/model-registry/data/initial-models";
import { tlToRegistryModel } from "@/modules/model-registry/lib/from-tl";
import type { RegistryModel } from "@/modules/model-registry/types";

/**
 * The data seam for the Model Registry.
 *
 * `seedModels()` gives the rich mock for instant first paint. `fetchModels()`
 * pulls the REAL models on disk from Transformer Lab via our `/api/models/catalog`
 * BFF (which uses a server-side permanent key, so it works regardless of the
 * app's mock login). The list/table then shows real models; deployment/usage/
 * evaluation analytics in the detail drawer stay mock (no TL backend).
 */

/** Sync seed for instant initial render. */
export function seedModels(): RegistryModel[] {
  return initialModels;
}

type CatalogResponse = {
  downloaded?: Array<{
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

/** Async load — real models from TL via the catalog BFF. */
export async function fetchModels(): Promise<RegistryModel[]> {
  try {
    const res = await fetch("/api/models/catalog", { cache: "no-store" });
    if (!res.ok) throw new Error(`catalog ${res.status}`);
    const data = (await res.json()) as CatalogResponse;
    const now = new Date().toISOString();
    const models = (data.downloaded ?? []).map((m) => tlToRegistryModel(m, now));
    // Keep the page useful even on a fresh TL with nothing downloaded yet.
    return models.length > 0 ? models : initialModels;
  } catch {
    // BFF unreachable (or non-browser context): degrade to the mock seed.
    return initialModels;
  }
}
