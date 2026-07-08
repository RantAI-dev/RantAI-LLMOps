"use client";

import type { StageKey, StageStatus } from "@/modules/workflows/hooks/use-pipeline";

/**
 * Local workflow-run history. Transformer Lab has no "pipeline" concept and we
 * have no DB, so each run is recorded in this browser's localStorage. It's honest
 * LOCAL history (per-browser, not team-shared) — enough to see past runs, their
 * config, per-stage outcome, and the trained model.
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
};

const KEY = "nqr:workflow-runs";
const MAX = 50;

export function loadRuns(): WorkflowRun[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as WorkflowRun[]) : [];
  } catch {
    return [];
  }
}

/** Prepend a run, cap the list, and persist. Returns the new list. */
export function addRun(run: WorkflowRun): WorkflowRun[] {
  const next = [run, ...loadRuns()].slice(0, MAX);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full/blocked — history is best-effort */
  }
  return next;
}

export function clearRuns(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
