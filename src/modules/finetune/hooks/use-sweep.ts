"use client";

import { useCallback, useState } from "react";

/**
 * Hyperparameter sweep, orchestrated app-side for a LOCAL single-GPU setup.
 *
 * Transformer Lab's native sweep fans out child jobs through a cloud compute
 * provider (`compute_provider/launch_sweep`), which doesn't fit a local box. So
 * we do the fan-out here: for each hyperparameter combination, train a fused
 * model → evaluate it → record the score, then rank. Runs SEQUENTIALLY because
 * the trainer/eval read their config from the experiment at run time (parallel
 * runs would clobber each other) — same constraint as eval-compare.
 */

export type SweepAxis = "learning_rate" | "lora_r" | "num_train_epochs";

export type SweepGrid = Partial<Record<SweepAxis, number[]>>;

export type SweepCombo = Partial<Record<SweepAxis, number>>;

export type SweepResult = {
  index: number;
  combo: SweepCombo;
  fusedModelId: string | null;
  score: number | null;
  status: "ok" | "train-failed" | "eval-failed";
};

export type SweepProgress = {
  index: number;
  total: number;
  phase: "training" | "evaluating";
};

export type SweepParams = {
  baseModel: string;
  baseModelArchitecture?: string;
  dataset: string;
  benchmark: string;
  limit: number;
  grid: SweepGrid;
};

const AXES: SweepAxis[] = ["learning_rate", "lora_r", "num_train_epochs"];
const TRAIN_TERMINAL = new Set(["COMPLETE", "COMPLETED", "FAILED", "STOPPED", "CANCELLED"]);
const EVAL_TERMINAL = new Set(["COMPLETE", "COMPLETED", "FAILED", "STOPPED", "CANCELLED"]);

/** Cartesian product of the populated grid axes. */
export function buildCombos(grid: SweepGrid): SweepCombo[] {
  const active = AXES.filter((a) => (grid[a]?.length ?? 0) > 0);
  if (active.length === 0) return [];
  let combos: SweepCombo[] = [{}];
  for (const axis of active) {
    const next: SweepCombo[] = [];
    for (const base of combos) {
      for (const value of grid[axis] as number[]) {
        next.push({ ...base, [axis]: value });
      }
    }
    combos = next;
  }
  return combos;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useSweep() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SweepProgress | null>(null);
  const [results, setResults] = useState<SweepResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  /** Poll a fine-tune job until it reaches a terminal status. */
  const waitTrain = useCallback(async (jobId: string): Promise<string> => {
    for (let i = 0; i < 400; i++) {
      await sleep(4000);
      try {
        const res = await fetch(`/api/finetune/jobs/${encodeURIComponent(jobId)}`);
        if (res.ok) {
          const job = (await res.json()) as { status?: string };
          const s = (job.status ?? "").toUpperCase();
          if (TRAIN_TERMINAL.has(s)) return s;
        }
      } catch {
        /* keep polling */
      }
    }
    return "TIMEOUT";
  }, []);

  /** Poll an eval job by id until terminal; return its headline accuracy. */
  const waitEval = useCallback(async (jobId: string): Promise<number | null> => {
    for (let i = 0; i < 300; i++) {
      await sleep(3000);
      try {
        const res = await fetch("/api/evals/jobs");
        const data = (await res.json()) as {
          jobs?: Array<{ id: string; status: string; scores: Array<{ type: string; score: number }> }>;
        };
        const job = (data.jobs ?? []).find((j) => j.id === jobId);
        if (job && EVAL_TERMINAL.has(job.status.toUpperCase())) {
          const acc = job.scores.find((s) => s.type.toLowerCase() === "acc") ?? job.scores[0];
          return acc ? acc.score : null;
        }
      } catch {
        /* keep polling */
      }
    }
    return null;
  }, []);

  /** Find the fused model produced by a training run, by its adaptor name. */
  const resolveFused = useCallback(async (adaptorName: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/models/catalog", { cache: "no-store" });
      const data = (await res.json()) as {
        fineTuned?: Array<{ name: string; fusedModelId: string }>;
      };
      return (data.fineTuned ?? []).find((m) => m.name === adaptorName)?.fusedModelId ?? null;
    } catch {
      return null;
    }
  }, []);

  const runSweep = useCallback(
    async (p: SweepParams) => {
      const combos = buildCombos(p.grid);
      if (combos.length === 0) {
        setError("Isi minimal satu hyperparameter dengan beberapa nilai.");
        return false;
      }
      setError(null);
      setResults([]);
      setRunning(true);
      // A stable-ish run tag without Date in the hot path is fine here (client runtime).
      const tag = Math.floor(Date.now() / 1000).toString(36);
      const out: SweepResult[] = [];
      try {
        for (let i = 0; i < combos.length; i++) {
          const combo = combos[i];
          const adaptorName = `sweep-${tag}-${i}`;
          setProgress({ index: i, total: combos.length, phase: "training" });

          // 1) Train a fused model for this combination.
          const trainRes = await fetch("/api/finetune/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              baseModel: p.baseModel,
              baseModelArchitecture: p.baseModelArchitecture,
              dataset: p.dataset,
              adaptorName,
              learningRate: combo.learning_rate,
              loraR: combo.lora_r,
              epochs: combo.num_train_epochs,
            }),
          });
          const trainData = (await trainRes.json()) as { jobId?: string; error?: string };
          if (!trainRes.ok || !trainData.jobId) {
            out.push({ index: i, combo, fusedModelId: null, score: null, status: "train-failed" });
            setResults([...out]);
            continue;
          }
          const trainStatus = await waitTrain(trainData.jobId);
          if (trainStatus !== "COMPLETE" && trainStatus !== "COMPLETED") {
            out.push({ index: i, combo, fusedModelId: null, score: null, status: "train-failed" });
            setResults([...out]);
            continue;
          }

          // 2) Evaluate the fused model on the chosen benchmark.
          setProgress({ index: i, total: combos.length, phase: "evaluating" });
          const fusedModelId = await resolveFused(adaptorName);
          if (!fusedModelId) {
            out.push({ index: i, combo, fusedModelId: null, score: null, status: "eval-failed" });
            setResults([...out]);
            continue;
          }
          const evalRes = await fetch("/api/evals/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: fusedModelId, benchmark: p.benchmark, limit: p.limit }),
          });
          const evalData = (await evalRes.json()) as { jobId?: string; error?: string };
          if (!evalRes.ok || !evalData.jobId) {
            out.push({ index: i, combo, fusedModelId, score: null, status: "eval-failed" });
            setResults([...out]);
            continue;
          }
          const score = await waitEval(evalData.jobId);
          out.push({
            index: i,
            combo,
            fusedModelId,
            score,
            status: score == null ? "eval-failed" : "ok",
          });
          setResults([...out]);
        }
        return true;
      } catch (err) {
        setError((err as Error).message);
        return false;
      } finally {
        setRunning(false);
        setProgress(null);
      }
    },
    [resolveFused, waitEval, waitTrain]
  );

  return { running, progress, results, error, runSweep };
}
