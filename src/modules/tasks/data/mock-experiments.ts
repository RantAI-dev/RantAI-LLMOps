/** @deprecated Use experiments from LlmOpsProvider / initial-experiments */
export { initialExperiments as MOCK_EXPERIMENTS } from "@/modules/experiments/data/initial-experiments";

import { initialExperiments } from "@/modules/experiments/data/initial-experiments";

export function getExperimentById(id: string) {
  return initialExperiments.find((e) => e.id === id);
}
