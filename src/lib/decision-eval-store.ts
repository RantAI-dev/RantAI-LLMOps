/**
 * Server-side record of decision-model (System One) eval runs, one JSON file per run in the app's
 * data directory. Same idea as the grounding and classification stores: a run starts server-side and
 * writes its progress here, so it survives leaving the page and past runs stay comparable (model A and
 * model B on the same test set, side by side).
 */
import crypto from "node:crypto";

import type { DecisionCase, DecisionReport, QuestionMeta } from "@/lib/decision-eval";
import { createJsonDirStore } from "@/lib/json-dir-store";

export type DecisionEvalStatus = "running" | "done" | "error" | "interrupted";

export type DecisionEvalRun = {
  id: string;
  /** The served model that answered. */
  model: string;
  setId: string;
  setName: string;
  status: DecisionEvalStatus;
  createdAt: number;
  updatedAt: number;
  /** Rows in the test set, and how many have been answered so far. */
  total: number;
  completed: number;
  /** Rows whose request failed: not scored, so the report covers fewer rows than `total`. */
  errorCount: number;
  errorSample?: string;
  error?: string;
  /** The question set, frozen at run time (drives the confusion matrices and re-scoring). */
  meta: Record<string, QuestionMeta>;
  report?: DecisionReport;
  cases?: DecisionCase[];
};

/** A run without its per-row cases: enough to list history cheaply. */
export type DecisionEvalRunSummary = Omit<DecisionEvalRun, "cases">;

/** Per-row detail is large (probabilities for every option), so only the newest runs are kept. */
const STALE_MS = 10 * 60 * 1000;
const KEEP_RUNS = 30;

const store = createJsonDirStore<DecisionEvalRun>({
  dirName: "decision-eval-runs",
  keep: KEEP_RUNS,
  staleMs: STALE_MS,
  heavy: ["cases"],
  sortKey: "createdAt",
});

export async function createDecisionEvalRun(input: {
  model: string;
  setId: string;
  setName: string;
  total: number;
  meta: Record<string, QuestionMeta>;
}): Promise<DecisionEvalRun> {
  const now = Date.now();
  return store.create({
    id: crypto.randomUUID(),
    model: input.model,
    setId: input.setId,
    setName: input.setName,
    status: "running",
    createdAt: now,
    updatedAt: now,
    total: input.total,
    completed: 0,
    errorCount: 0,
    meta: input.meta,
  });
}

export const readDecisionEvalRun = (id: string) => store.read(id);
export const saveDecisionEvalRun = (run: DecisionEvalRun) => store.save(run);
export const deleteDecisionEvalRun = (id: string) => store.remove(id);
export const pruneDecisionEvalRuns = () => store.prune();
export const listDecisionEvalRuns = async (): Promise<DecisionEvalRunSummary[]> =>
  (await store.list()) as DecisionEvalRunSummary[];
