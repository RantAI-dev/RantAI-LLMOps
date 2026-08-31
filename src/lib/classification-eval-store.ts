/**
 * Server-side record of classification eval runs. Mirrors the grounding
 * eval-run-store (@/lib/eval-run-store): runs start server-side and write their
 * progress here, so the work survives leaving the page and past runs (base vs
 * fine-tune) stay comparable. One file per run.
 */
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import type { ClassCase, ClassificationReport } from "@/lib/classification-eval";

export type ClassEvalStatus = "running" | "done" | "error" | "interrupted";

export type ClassEvalRun = {
  id: string;
  model: string;
  systemPrompt: string;
  maxTokens: number;
  status: ClassEvalStatus;
  createdAt: number;
  updatedAt: number;
  total: number;
  completed: number;
  /** The class set, frozen at run time (drives the confusion matrix + rescoring). */
  labels: string[];
  report?: ClassificationReport;
  cases?: ClassCase[];
  errorCount: number;
  errorSample?: string;
  error?: string;
};

/** A run without its per-row cases — enough to list history cheaply. */
export type ClassEvalRunSummary = Omit<ClassEvalRun, "cases">;

const DATA_DIR = process.env.RANTAI_DATA_DIR ?? path.join(process.cwd(), ".rantai-data");
const RUNS_DIR = path.join(DATA_DIR, "class-eval-runs");
const STALE_MS = 5 * 60 * 1000;
const KEEP_RUNS = 30;

function runFile(id: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error(`Invalid run id: ${JSON.stringify(id)}`);
  return path.join(RUNS_DIR, `${id}.json`);
}

async function atomicWrite(file: string, data: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, data, "utf8");
  await fs.rename(tmp, file);
}

function withDerivedStatus(run: ClassEvalRun): ClassEvalRun {
  if (run.status === "running" && Date.now() - run.updatedAt > STALE_MS) {
    return { ...run, status: "interrupted", error: "The process stopped before finishing (server restart?)" };
  }
  return run;
}

export async function createClassEvalRun(input: {
  model: string;
  systemPrompt: string;
  maxTokens: number;
  total: number;
  labels: string[];
}): Promise<ClassEvalRun> {
  const now = Date.now();
  const run: ClassEvalRun = {
    id: crypto.randomUUID(),
    model: input.model,
    systemPrompt: input.systemPrompt,
    maxTokens: input.maxTokens,
    status: "running",
    createdAt: now,
    updatedAt: now,
    total: input.total,
    completed: 0,
    labels: input.labels,
    errorCount: 0,
  };
  await atomicWrite(runFile(run.id), JSON.stringify(run));
  return run;
}

export async function readClassEvalRun(id: string): Promise<ClassEvalRun | null> {
  try {
    return withDerivedStatus(JSON.parse(await fs.readFile(runFile(id), "utf8")) as ClassEvalRun);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[class-eval-store] read failed:", err);
    }
    return null;
  }
}

export async function saveClassEvalRun(run: ClassEvalRun): Promise<void> {
  await atomicWrite(runFile(run.id), JSON.stringify({ ...run, updatedAt: Date.now() }));
}

export async function listClassEvalRuns(): Promise<ClassEvalRunSummary[]> {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") return (await import("@/lib/demo/stores")).demoClassRunSummaries();
  let names: string[];
  try {
    names = await fs.readdir(RUNS_DIR);
  } catch {
    return [];
  }
  const runs: ClassEvalRunSummary[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(await fs.readFile(path.join(RUNS_DIR, name), "utf8")) as ClassEvalRun;
      const { cases: _cases, ...summary } = withDerivedStatus(raw);
      void _cases;
      runs.push(summary);
    } catch {
      /* skip a corrupt/half-written file */
    }
  }
  return runs.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteClassEvalRun(id: string): Promise<void> {
  await fs.rm(runFile(id), { force: true });
}

export async function pruneClassEvalRuns(): Promise<void> {
  try {
    const runs = await listClassEvalRuns();
    await Promise.all(runs.slice(KEEP_RUNS).map((r) => deleteClassEvalRun(r.id)));
  } catch (err) {
    console.error("[class-eval-store] prune failed:", err);
  }
}
