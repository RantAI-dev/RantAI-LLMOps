import { USE_REAL_API } from "@/lib/api/config";
import { initialProviders } from "@/modules/compute/data/initial-compute";
import type { ComputeProvider } from "@/modules/compute/types";

/**
 * The data seam for compute providers/clusters. Mock today; real Transformer
 * Lab wiring later. The page calls THESE so the mock→real swap stays in one
 * place.
 *
 * NOTE: TL exposes providers/clusters under `/compute_provider/*`. The real
 * path (list providers + cluster status) is an intentional TODO.
 */

/** Sync seed for instant initial render while the real API is off. */
export function seedComputeProviders(): ComputeProvider[] {
  return initialProviders;
}

/** Async load — mock today; real `GET /compute_provider/*` (+ mapping) is a TODO. */
export async function fetchComputeProviders(): Promise<ComputeProvider[]> {
  if (!USE_REAL_API) return initialProviders;
  // TODO: GET /compute_provider/* and map TL providers/clusters into ComputeProvider.
  return initialProviders;
}
