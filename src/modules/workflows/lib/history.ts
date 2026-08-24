"use client";

import type { StageKey, StageStatus } from "@/modules/workflows/hooks/use-pipeline";

/**
 * Workflow-run history. Persisted SERVER-SIDE via /api/workflows/runs
 * (src/lib/workflow-run-store.ts), so it's team-visible and survives a browser
 * cache clear — consistent with how eval runs are stored.
 */

export type RunOverall = "success" | "partial" | "failed";

export type WorkflowRun = {
  id: string; // start timestamp (unique per click)
  startedAt: string;
  finishedAt: string;
  baseModel: string;
  dataset: string;
  adaptorName: string;
  epochs: number;
  benchmark: string;
  coverage: number;
  stages: { key: StageKey; label: string; status: StageStatus }[];
  score: number | null;
  ggufReady: boolean;
  loadModelId: string | null;
  trainJobId: string | null;
  overall: RunOverall;
  // --- Flyte-inspired caching + versioning + resume (all optional so runs
  //     recorded before this feature stay valid) ---
  /** Content hash of the training inputs — the cache key. */
  configHash?: string;
  /** CACHE_VERSION at record time; a mismatch disqualifies the run from cache reuse. */
  cacheVersion?: number;
  /** Which optional stages the user asked for — needed to resume exactly. */
  requestedStages?: { eval: boolean; export: boolean };
  /** True when this run reused a prior adapter instead of training a new one. */
  cached?: boolean;
};

const API = "/api/workflows/runs";

/** All runs, newest first (from the server). */
export async function loadRuns(): Promise<WorkflowRun[]> {
  try {
    const res = await fetch(API, { cache: "no-store" });
    const data = (await res.json()) as { runs?: WorkflowRun[] };
    return Array.isArray(data.runs) ? data.runs : [];
  } catch {
    return [];
  }
}

/** Persist a run; returns the server's updated list, or null on failure (so the
 *  caller keeps its optimistic list rather than clobbering it). */
export async function addRun(run: WorkflowRun): Promise<WorkflowRun[] | null> {
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(run),
    });
    const data = (await res.json()) as { runs?: WorkflowRun[] };
    if (res.ok && Array.isArray(data.runs)) return data.runs;
  } catch {
    /* best-effort */
  }
  return null;
}

export async function clearRuns(): Promise<void> {
  try {
    await fetch(API, { method: "DELETE" });
  } catch {
    /* ignore */
  }
}
