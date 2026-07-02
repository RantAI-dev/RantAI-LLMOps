import { describe, expect, it } from "vitest";

import { fetchExperiments, seedExperiments } from "@/modules/experiments/services/experiments-service";
import { fetchTasks, seedTasks } from "@/modules/tasks/services/tasks-service";
import { fetchDatasets, seedDatasets } from "@/modules/datasets/services/datasets-service";
import { fetchComputeProviders, seedComputeProviders } from "@/modules/compute/services/compute-service";

/**
 * Default (mock) mode: these services' sync seed returns non-empty data and the
 * async fetch resolves to the same shape. This locks the seam contract so the
 * mock→real swap stays a drop-in.
 *
 * NOTE: the Model Registry has graduated to real-only (seed = [], fetch pulls the
 * real Ollama models and throws on backend error) so it's intentionally NOT in
 * this mock-seam contract.
 */
const seeds = [
  ["experiments", seedExperiments, fetchExperiments],
  ["tasks", seedTasks, fetchTasks],
  ["datasets", seedDatasets, fetchDatasets],
  ["compute", seedComputeProviders, fetchComputeProviders],
] as const;

describe("service seam (mock mode)", () => {
  for (const [name, seed, fetcher] of seeds) {
    it(`${name}: seed returns a non-empty array`, () => {
      const data = seed();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    it(`${name}: fetch resolves to the same count as the seed`, async () => {
      const data = await fetcher();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(seed().length);
    });
  }
});
