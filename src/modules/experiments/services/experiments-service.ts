import { initialExperiments } from "@/modules/experiments/data/initial-experiments";
import type { Experiment } from "@/modules/experiments/types";

/**
 * The data seam for experiments. Today every function returns mock data; when
 * `USE_REAL_API` is on, the async ones hit Transformer Lab instead. Components
 * and the provider call THESE — they never import mock data directly.
 */

/** Sync seed for instant initial render while the real API is off. */
export function seedExperiments(): Experiment[] {
  return initialExperiments;
}

/**
 * Async load — REAL Transformer Lab experiments via our `/api/experiments/list`
 * BFF (server-side permanent key, independent of the app's mock login). TL
 * experiments are thin (id + name); fields the UI shows but TL doesn't track are
 * filled with sensible defaults by `mapExperiment`.
 */
export async function fetchExperiments(): Promise<Experiment[]> {
  try {
    const res = await fetch("/api/experiments/list", { cache: "no-store" });
    if (!res.ok) throw new Error(`experiments ${res.status}`);
    const data = (await res.json()) as { experiments?: TlExperiment[] };
    const raw = Array.isArray(data.experiments) ? data.experiments : [];
    // Return the REAL list even when empty — an empty backend is honest data, not
    // a reason to show demo experiments. Mock is only for the unreachable-BFF case.
    return raw.map(mapExperiment);
  } catch {
    // BFF unreachable (or non-browser context): degrade to the mock seed.
    return initialExperiments;
  }
}

// Notes are a per-experiment markdown notebook (TL stores it as `notes/readme.md`
// inside the experiment dir). The notes editor reads/writes them directly against
// the BFF (`/api/experiments/{id}/notes`), so no service helper is needed here.

// --- Real-API mapping (TODO: confirm exact fields against backend/) -----------

type TlExperiment = {
  id: string | number;
  name: string;
  created_at?: string;
  updated_at?: string;
};

/**
 * TL experiments are much thinner than ours (basically id + name + config), so
 * fields the UI shows but TL doesn't track are filled with sensible defaults.
 */
function mapExperiment(e: TlExperiment): Experiment {
  return {
    id: String(e.id),
    name: e.name,
    description: "",
    objective: "",
    status: "Active",
    owner: "—",
    baseModel: "—",
    dataset: "—",
    // TL experiments don't define a success metric/threshold — show honest "—"
    // rather than implying an "Accuracy" target was configured.
    successMetric: "—",
    evaluationThreshold: "—",
    bestScore: 0,
    tags: [],
    notes: "",
    createdAt: e.created_at ?? "",
    updatedAt: e.updated_at ?? e.created_at ?? "",
    activityHistory: [],
  };
}
