/**
 * A "deployment" = a named, saved choice of which model to serve. Client-safe
 * type + id factory (no persistence here — the list lives server-side via
 * `/api/serve/deployments` so it's shared across everyone using this app instance,
 * and survives browser/device changes).
 */
export type Deployment = {
  id: string;
  name: string;
  modelId: string; // catalog id to load
  modelLabel: string;
  isGguf: boolean;
  createdAt: string;
};

export function makeDeployment(input: {
  name: string;
  modelId: string;
  modelLabel: string;
  isGguf: boolean;
}): Deployment {
  return {
    id: `dep-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: input.name,
    modelId: input.modelId,
    modelLabel: input.modelLabel,
    isGguf: input.isGguf,
    createdAt: new Date().toISOString(),
  };
}
