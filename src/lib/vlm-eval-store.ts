/**
 * Server-side record of image-and-text (VLM) eval runs, one JSON file per run under
 * `$RANTAI_DATA_DIR/vlm-eval-runs`. Same shape and reasons as the Decision eval store: a run starts on the
 * server and writes its progress here, so it survives leaving the page, and past runs stay comparable
 * (base and fine-tune on the same set, side by side).
 */
import crypto from "node:crypto";

import { createJsonDirStore } from "@/lib/json-dir-store";
import type { VlmCase, VlmEvalReport, VlmScoring } from "@/lib/vlm-eval";

export type VlmEvalStatus = "running" | "done" | "error" | "interrupted";

export type VlmEvalProgress = {
  completed: number;
  total: number;
  /** Rows whose request failed so far (not scored). */
  errors: number;
  /** Rows answered correctly so far, for the live number. */
  correct: number;
};

export type VlmEvalRun = {
  id: string;
  setId: string;
  setName: string;
  /** The name the person picked (`base`, an adapter name, an Ollama tag). */
  model: string;
  engine: string;
  scoring: VlmScoring;
  maxTokens: number;
  status: VlmEvalStatus;
  startedAt: number;
  finishedAt?: number;
  updatedAt: number;
  progress: VlmEvalProgress;
  /** First request error, for the banner. */
  errorSample?: string;
  error?: string;
  report?: VlmEvalReport;
  cases?: VlmCase[];
};

/** A run without its per-row cases: enough to list history cheaply. */
export type VlmEvalRunSummary = Omit<VlmEvalRun, "cases">;

const STALE_MS = 10 * 60 * 1000;
const KEEP_RUNS = 30;

const store = createJsonDirStore<VlmEvalRun>({
  dirName: "vlm-eval-runs",
  keep: KEEP_RUNS,
  staleMs: STALE_MS,
  heavy: ["cases"],
  sortKey: "startedAt",
});

export async function createVlmEvalRun(input: {
  setId: string;
  setName: string;
  model: string;
  engine: string;
  scoring: VlmScoring;
  maxTokens: number;
  total: number;
}): Promise<VlmEvalRun> {
  const now = Date.now();
  return store.create({
    id: crypto.randomUUID(),
    setId: input.setId,
    setName: input.setName,
    model: input.model,
    engine: input.engine,
    scoring: input.scoring,
    maxTokens: input.maxTokens,
    status: "running",
    startedAt: now,
    updatedAt: now,
    progress: { completed: 0, total: input.total, errors: 0, correct: 0 },
  });
}

export const readVlmEvalRun = (id: string) => store.read(id);
export const saveVlmEvalRun = (run: VlmEvalRun) => store.save(run);
export const deleteVlmEvalRun = (id: string) => store.remove(id);
export const pruneVlmEvalRuns = () => store.prune();
export const listVlmEvalRuns = async (): Promise<VlmEvalRunSummary[]> => (await store.list()) as VlmEvalRunSummary[];
