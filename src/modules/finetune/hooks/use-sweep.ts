"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  /** Train job id of this combo (the export input), or null if training failed. */
  fusedModelId: string | null;
  /** Adaptor name — export this to chat with the combo's model. */
  adaptorName: string;
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

  // A sweep can poll for many minutes per combo. Stop the loop and abort the
  // in-flight request on unmount so we neither leak a long background poll nor
  // setState on a gone component.
  const cancelledRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    // Reset on mount so StrictMode's mount→cleanup→mount cycle doesn't leave the
    // flag stuck true (which would make every sweep bail immediately).
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      abortRef.current?.abort();
    };
  }, []);

  /** Poll a fine-tune job until it reaches a terminal status (or we unmount). */
  const waitTrain = useCallback(async (jobId: string): Promise<string> => {
    for (let i = 0; i < 400; i++) {
      if (cancelledRef.current) return "CANCELLED";
      await sleep(4000);
      if (cancelledRef.current) return "CANCELLED";
      try {
        const res = await fetch(`/api/finetune/jobs/${encodeURIComponent(jobId)}`, {
          signal: abortRef.current?.signal,
        });
        if (res.ok) {
          const job = (await res.json()) as { status?: string };
          const s = (job.status ?? "").toUpperCase();
          if (TRAIN_TERMINAL.has(s)) return s;
        }
      } catch {
        /* keep polling (also catches the abort on unmount) */
      }
    }
    return "TIMEOUT";
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
      abortRef.current = new AbortController();
      // A stable-ish run tag without Date in the hot path is fine here (client runtime).
      const tag = Math.floor(Date.now() / 1000).toString(36);
      const out: SweepResult[] = [];
      try {
        for (let i = 0; i < combos.length; i++) {
          if (cancelledRef.current) return false;
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
            signal: abortRef.current.signal,
          });
          const trainData = (await trainRes.json()) as { jobId?: string; error?: string };
          if (!trainRes.ok || !trainData.jobId) {
            out.push({
              index: i,
              combo,
              fusedModelId: null,
              adaptorName,
              score: null,
              status: "train-failed",
            });
            setResults([...out]);
            continue;
          }
          const trainStatus = await waitTrain(trainData.jobId);
          if (cancelledRef.current || trainStatus === "CANCELLED") return false;
          if (trainStatus !== "COMPLETE" && trainStatus !== "COMPLETED") {
            out.push({
              index: i,
              combo,
              fusedModelId: null,
              adaptorName,
              score: null,
              status: "train-failed",
            });
            setResults([...out]);
            continue;
          }

          // v0.40.0: the lm-eval harness can't score a LoRA adapter (it isn't on
          // HF), so we don't auto-rank by benchmark here. Each combo produces a
          // trained adapter (its train job id) — export the promising one(s) and
          // compare them in Generations / chat.
          out.push({
            index: i,
            combo,
            fusedModelId: trainData.jobId,
            adaptorName,
            score: null,
            status: "ok",
          });
          setResults([...out]);
        }
        return true;
      } catch (err) {
        if (cancelledRef.current) return false; // unmounted mid-run — don't setState
        setError((err as Error).message);
        return false;
      } finally {
        if (!cancelledRef.current) {
          setRunning(false);
          setProgress(null);
        }
      }
    },
    [waitTrain]
  );

  return { running, progress, results, error, runSweep };
}
