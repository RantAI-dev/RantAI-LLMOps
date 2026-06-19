import { apiFetch } from "@/lib/api/client";
import { USE_REAL_API } from "@/lib/api/config";
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
    return raw.length > 0 ? raw.map(mapExperiment) : initialExperiments;
  } catch {
    // BFF unreachable (or non-browser context): degrade to the mock seed.
    return initialExperiments;
  }
}

/**
 * Notes are a per-experiment markdown notebook (TL stores it as
 * `notes/readme.md` inside the experiment dir). In mock mode the content lives
 * on the in-memory `Experiment.notes` field, so these only do work when the
 * real API is on.
 */

/** Read notes markdown — real `GET /experiment/{id}/notes` returns a raw string. */
export async function fetchExperimentNotes(id: string): Promise<string> {
  if (!USE_REAL_API) return "";
  return apiFetch<string>(`/experiment/${id}/notes`);
}

/** Save notes markdown — real `POST /experiment/{id}/notes` (body = the string). */
export async function saveExperimentNotes(id: string, content: string): Promise<void> {
  if (!USE_REAL_API) return;
  await apiFetch(`/experiment/${id}/notes`, {
    method: "POST",
    body: JSON.stringify(content),
  });
}

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
    successMetric: "Accuracy",
    evaluationThreshold: "—",
    bestScore: 0,
    tags: [],
    notes: "",
    createdAt: e.created_at ?? "",
    updatedAt: e.updated_at ?? e.created_at ?? "",
    activityHistory: [],
  };
}
