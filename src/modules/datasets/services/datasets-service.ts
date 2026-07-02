import { tlToDataset } from "@/modules/datasets/lib/from-tl";
import { loadDatasetsFromStorage } from "@/modules/datasets/lib/storage";
import type { Dataset } from "@/modules/datasets/types";

/**
 * The data seam for datasets — REAL only.
 *
 * `seedDatasets()` restores the last real list cached in localStorage for an
 * instant first paint (empty on a fresh machine). `fetchDatasets()` pulls the
 * real datasets on disk from Transformer Lab via `/api/datasets/list`. There is
 * no mock fallback: an empty backend shows an empty list (honest), not demo data.
 */

/** Sync seed for instant initial render — the locally-cached real list, or []. */
export function seedDatasets(): Dataset[] {
  return loadDatasetsFromStorage([]);
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
    return (data.datasets ?? []).map((d) => tlToDataset(d, now));
  } catch {
    // BFF unreachable (or non-browser context): degrade to the cached list, not mock.
    return loadDatasetsFromStorage([]);
  }
}
