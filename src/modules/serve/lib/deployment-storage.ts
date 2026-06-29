/**
 * Deployment definitions persisted in the browser (no auth/backend for this yet).
 * A "deployment" = a named, saved choice of which model to serve. On a single
 * local GPU only one can be active (loaded) at a time; this just remembers the
 * named configs and which one the user last deployed.
 */

export type Deployment = {
  id: string;
  name: string;
  modelId: string; // catalog id to load
  modelLabel: string;
  isGguf: boolean;
  createdAt: string;
};

const KEY = "nqr.deployments.v1";
const ACTIVE_KEY = "nqr.deployments.active";

export function loadDeployments(): Deployment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Deployment[]) : [];
  } catch {
    return [];
  }
}

export function saveDeployments(deployments: Deployment[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(deployments));
  } catch {
    /* ignore quota errors */
  }
}

export function getActiveId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function setActiveId(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id) window.localStorage.setItem(ACTIVE_KEY, id);
    else window.localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}

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
