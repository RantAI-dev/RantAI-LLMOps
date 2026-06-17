import { USE_REAL_API } from "@/lib/api/config";
import { initialDatasets } from "@/modules/datasets/data/initial-datasets";
import { loadDatasetsFromStorage } from "@/modules/datasets/lib/storage";
import { mergeRagDefaults } from "@/modules/datasets/lib/rag-utils";
import type { Dataset } from "@/modules/datasets/types";

/**
 * The data seam for datasets. Mock today (seeded from local fixtures, with any
 * locally-persisted edits restored); real Transformer Lab wiring later. The
 * provider calls THESE — it never imports mock data directly, so the mock→real
 * swap stays in one place.
 *
 * NOTE: TL datasets live under `/data/*` and are scoped per experiment, and the
 * RAG knowledge-base subsystem has no TL backend yet — so the real path is an
 * intentional TODO; the seam is here and ready.
 */

/** Sync seed for instant initial render — restores any locally-persisted edits. */
export function seedDatasets(): Dataset[] {
  return mergeRagDefaults(loadDatasetsFromStorage(initialDatasets));
}

/** Async load — mock today; real `GET /data/list` (+ mapping) is a TODO. */
export async function fetchDatasets(): Promise<Dataset[]> {
  if (!USE_REAL_API) return mergeRagDefaults(initialDatasets);
  // TODO: GET /data/list and map TL dataset info into our Dataset shape.
  return mergeRagDefaults(initialDatasets);
}
