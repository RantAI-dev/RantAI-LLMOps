import { initialDatasets } from "@/modules/datasets/data/initial-datasets";
import { tlToDataset } from "@/modules/datasets/lib/from-tl";
import { loadDatasetsFromStorage } from "@/modules/datasets/lib/storage";
import { mergeRagDefaults } from "@/modules/datasets/lib/rag-utils";
import type { Dataset } from "@/modules/datasets/types";

/**
 * The data seam for datasets.
 *
 * `seedDatasets()` gives the rich mock for instant first paint. `fetchDatasets()`
 * pulls the REAL datasets on disk from Transformer Lab via our `/api/datasets/list`
 * BFF (server-side permanent key, independent of the app's mock login). The
 * list/table then shows real datasets; quality-scan / version / usage analytics
 * in the detail drawer stay mock (no TL backend). The RAG knowledge-base
 * defaults are merged in so that subsystem still renders.
 */

/** Sync seed for instant initial render — restores any locally-persisted edits. */
export function seedDatasets(): Dataset[] {
  return mergeRagDefaults(loadDatasetsFromStorage(initialDatasets));
}

type DatasetsResponse = {
  datasets?: Array<{ id: string; description: string; sizeMb: number | null }>;
};

/** Async load — real datasets from TL via the datasets BFF. */
export async function fetchDatasets(): Promise<Dataset[]> {
  try {
    const res = await fetch("/api/datasets/list", { cache: "no-store" });
    if (!res.ok) throw new Error(`datasets ${res.status}`);
    const data = (await res.json()) as DatasetsResponse;
    const now = new Date().toISOString();
    const real = (data.datasets ?? []).map((d) => tlToDataset(d, now));
    // On a fresh TL with no datasets, fall back to the full mock so the page isn't bare.
    if (real.length === 0) return mergeRagDefaults(initialDatasets);
    return mergeRagDefaults(real);
  } catch {
    // BFF unreachable (or non-browser context): degrade to the mock seed.
    return mergeRagDefaults(initialDatasets);
  }
}
