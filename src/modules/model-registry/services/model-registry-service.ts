import { USE_REAL_API } from "@/lib/api/config";
import { initialModels } from "@/modules/model-registry/data/initial-models";
import type { RegistryModel } from "@/modules/model-registry/types";

/**
 * The data seam for the Model Registry. Mock today; real Transformer Lab wiring
 * later. The provider calls THESE so the mock→real swap stays in one place.
 *
 * NOTE: TL exposes models under `/model/*`. Serving/deploy orchestration and
 * per-model usage analytics have no TL backend, so the real path is a TODO.
 */

/** Sync seed for instant initial render while the real API is off. */
export function seedModels(): RegistryModel[] {
  return initialModels;
}

/** Async load — mock today; real `GET /model/list` (+ mapping) is a TODO. */
export async function fetchModels(): Promise<RegistryModel[]> {
  if (!USE_REAL_API) return initialModels;
  // TODO: GET /model/list (+ /model/{id}) and map TL models into RegistryModel.
  return initialModels;
}
