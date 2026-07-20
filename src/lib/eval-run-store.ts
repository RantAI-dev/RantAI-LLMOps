/**
 * Server-side record of grounding eval runs.
 *
 * Evals used to live inside the request that started them, so navigating away
 * threw away the run — fine for a 46-row smoke test, painful for the hundreds of
 * rows a real eval set has. Runs are now started server-side and their progress
 * is written here, which buys two things: the work survives leaving the page,
 * and past runs stay comparable (the baseline and the fine-tune sitting side by
 * side is the whole point of running an eval twice).
 *
 * One file per run, not one shared file: progress is written repeatedly while a
 * run is in flight, and concurrent runs writing a shared file would clobber each
 * other's updates.
 */
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { GroundingReport, ScoredCase } from "@/lib/grounding-eval";

export type EvalRunStatus = "running" | "done" | "error" | "interrupted";

export type EvalRun = {
  id: string;
  model: string;
  systemPrompt: string;
  maxTokens: number;
  status: EvalRunStatus;
  createdAt: number;
  updatedAt: number;
  /** Rows in the eval set, and how many have been scored so far. */
  total: number;
  completed: number;
  report?: GroundingReport;
  cases?: ScoredCase[];
  /** Requests that failed and were scored as empty replies — the report is
   *  pessimistic when this is non-zero. */
  errorCount: number;
  errorSample?: string;
  error?: string;
};

/** A run without its per-row cases — enough to list history cheaply. */
export type EvalRunSummary = Omit<EvalRun, "cases">;

const DATA_DIR = process.env.RANTAI_DATA_DIR ?? path.join(process.cwd(), ".rantai-data");
const RUNS_DIR = path.join(DATA_DIR, "eval-runs");
/** A "running" run whose progress stopped this long ago lost its process (a
 *  container restart, say). Reporting it as still running would be a lie. */
const STALE_MS = 5 * 60 * 1000;
/** Keep history bounded; the cases array makes each file sizeable. */
const KEEP_RUNS = 30;

function runFile(id: string): string {
  // ids are generated here (UUIDs), but this value reaches the filesystem, so
  // refuse anything that could escape the directory.
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error(`Invalid run id: ${JSON.stringify(id)}`);
  return path.join(RUNS_DIR, `${id}.json`);
}

async function atomicWrite(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data, "utf8");
  await fs.rename(tmp, file);
}

/** Surface a stalled run as interrupted rather than perpetually "running". */
function withDerivedStatus(run: EvalRun): EvalRun {
  if (run.status === "running" && Date.now() - run.updatedAt > STALE_MS) {
    return { ...run, status: "interrupted", error: "Proses berhenti sebelum selesai (server restart?)" };
  }
  return run;
}

export async function createEvalRun(input: {
  model: string;
  systemPrompt: string;
  maxTokens: number;
  total: number;
}): Promise<EvalRun> {
  const now = Date.now();
  const run: EvalRun = {
    id: crypto.randomUUID(),
    model: input.model,
    systemPrompt: input.systemPrompt,
    maxTokens: input.maxTokens,
    status: "running",
    createdAt: now,
    updatedAt: now,
    total: input.total,
    completed: 0,
    errorCount: 0,
  };
  await atomicWrite(runFile(run.id), JSON.stringify(run));
  return run;
}

export async function readEvalRun(id: string): Promise<EvalRun | null> {
  try {
    return withDerivedStatus(JSON.parse(await fs.readFile(runFile(id), "utf8")) as EvalRun);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[eval-run-store] read failed:", err);
    }
    return null;
  }
}

export async function saveEvalRun(run: EvalRun): Promise<void> {
  await atomicWrite(runFile(run.id), JSON.stringify({ ...run, updatedAt: Date.now() }));
}

export async function listEvalRuns(): Promise<EvalRunSummary[]> {
  let names: string[];
  try {
    names = await fs.readdir(RUNS_DIR);
  } catch {
    return []; // no runs yet
  }
  const runs: EvalRunSummary[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(await fs.readFile(path.join(RUNS_DIR, name), "utf8")) as EvalRun;
      const { cases: _cases, ...summary } = withDerivedStatus(raw);
      void _cases;
      runs.push(summary);
    } catch {
      /* skip a corrupt/half-written file rather than failing the whole list */
    }
  }
  return runs.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteEvalRun(id: string): Promise<void> {
  await fs.rm(runFile(id), { force: true });
}

/** Drop the oldest runs beyond KEEP_RUNS. Best-effort: history is a convenience,
 *  and failing to prune must never fail the run that triggered it. */
export async function pruneEvalRuns(): Promise<void> {
  try {
    const runs = await listEvalRuns();
    await Promise.all(runs.slice(KEEP_RUNS).map((r) => deleteEvalRun(r.id)));
  } catch (err) {
    console.error("[eval-run-store] prune failed:", err);
  }
}
