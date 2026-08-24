/**
 * Server-side workflow-run history: one JSON file per run under
 * `$RANTAI_DATA_DIR/workflow-runs/`. Moved off browser localStorage so history
 * is team-visible and survives a cache clear — mirrors eval-run-store.
 */
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Structural copy of the client `WorkflowRun` (kept server-local so this file
 * needn't import the "use client" history module). Shape must stay in sync with
 * src/modules/workflows/lib/history.ts.
 */
export type WorkflowRun = {
  id: string;
  startedAt: string;
  finishedAt: string;
  baseModel: string;
  dataset: string;
  adaptorName: string;
  epochs: number;
  benchmark: string;
  coverage: number;
  stages: { key: string; label: string; status: string }[];
  score: number | null;
  ggufReady: boolean;
  loadModelId: string | null;
  trainJobId: string | null;
  overall: "success" | "partial" | "failed";
  // Optional caching/versioning/resume fields (kept in sync with
  // src/modules/workflows/lib/history.ts).
  configHash?: string;
  cacheVersion?: number;
  requestedStages?: { eval: boolean; export: boolean };
  cached?: boolean;
};

const DATA_DIR = process.env.RANTAI_DATA_DIR ?? path.join(process.cwd(), ".rantai-data");
const RUNS_DIR = path.join(DATA_DIR, "workflow-runs");
const KEEP_RUNS = 50;

function runFile(id: string): string {
  // ids are UUIDs generated client-side, but this reaches the filesystem — refuse
  // anything that could escape the directory.
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error(`Invalid run id: ${JSON.stringify(id)}`);
  return path.join(RUNS_DIR, `${id}.json`);
}

async function atomicWrite(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, data, "utf8");
  await fs.rename(tmp, file);
}

/** All runs, newest first (by ISO `startedAt`, which sorts lexicographically). */
export async function listWorkflowRuns(): Promise<WorkflowRun[]> {
  let names: string[];
  try {
    names = await fs.readdir(RUNS_DIR);
  } catch {
    return []; // no runs yet
  }
  const runs: WorkflowRun[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      runs.push(JSON.parse(await fs.readFile(path.join(RUNS_DIR, name), "utf8")) as WorkflowRun);
    } catch {
      /* skip a corrupt/half-written file rather than failing the whole list */
    }
  }
  return runs.sort((a, b) => (b.startedAt || "").localeCompare(a.startedAt || ""));
}

export async function saveWorkflowRun(run: WorkflowRun): Promise<void> {
  await atomicWrite(runFile(run.id), JSON.stringify(run));
  await prune();
}

/** Keep history bounded — delete the oldest runs beyond KEEP_RUNS. */
async function prune(): Promise<void> {
  const runs = await listWorkflowRuns();
  for (const old of runs.slice(KEEP_RUNS)) {
    try {
      await fs.rm(runFile(old.id));
    } catch {
      /* ignore */
    }
  }
}

export async function clearWorkflowRuns(): Promise<void> {
  try {
    await fs.rm(RUNS_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
