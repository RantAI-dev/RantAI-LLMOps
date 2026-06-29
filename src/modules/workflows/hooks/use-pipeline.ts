"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One-click LLMOps pipeline: fine-tune → eval → export GGUF, run automatically
 * in sequence. App-orchestrated over the proven BFF routes (not TL's native
 * workflow engine), so it reuses exactly the paths that already work and gives
 * full control over progress/results.
 */

export type StageKey = "train" | "eval" | "export";
export type StageStatus = "pending" | "running" | "done" | "failed" | "skipped";
export type Stage = { key: StageKey; label: string; status: StageStatus; detail?: string };

export type PipelineResult = {
  adaptorName: string;
  fusedModelId: string | null;
  score: number | null;
  ggufReady: boolean;
  loadModelId: string | null;
};

export type PipelineConfig = {
  baseModel: string;
  baseModelArchitecture?: string;
  dataset: string;
  adaptorName: string;
  epochs: number;
  benchmark: string;
  coverage: number; // %
  doEval: boolean;
  doExport: boolean;
};

const TRAIN_TERMINAL = new Set(["COMPLETE", "COMPLETED", "FAILED", "STOPPED", "CANCELLED"]);
const EVAL_TERMINAL = new Set(["COMPLETE", "COMPLETED", "FAILED", "STOPPED", "CANCELLED"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function initialStages(doEval: boolean, doExport: boolean): Stage[] {
  return [
    { key: "train", label: "Fine-tune", status: "pending" },
    { key: "eval", label: "Eval", status: doEval ? "pending" : "skipped" },
    { key: "export", label: "Export GGUF", status: doExport ? "pending" : "skipped" },
  ];
}

export function usePipeline() {
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<Stage[]>([]);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const setStage = useCallback((key: StageKey, patch: Partial<Stage>) => {
    setStages((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }, []);

  const run = useCallback(
    async (cfg: PipelineConfig) => {
      setError(null);
      setResult(null);
      setStages(initialStages(cfg.doEval, cfg.doExport));
      setRunning(true);
      const out: PipelineResult = {
        adaptorName: cfg.adaptorName,
        fusedModelId: null,
        score: null,
        ggufReady: false,
        loadModelId: null,
      };

      try {
        // 1) TRAIN ---------------------------------------------------------
        setStage("train", { status: "running", detail: "Mengirim job…" });
        const trainRes = await fetch("/api/finetune/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            baseModel: cfg.baseModel,
            baseModelArchitecture: cfg.baseModelArchitecture,
            dataset: cfg.dataset,
            adaptorName: cfg.adaptorName,
            epochs: cfg.epochs,
          }),
        });
        const trainData = (await trainRes.json()) as { jobId?: string; error?: string };
        if (!trainRes.ok || !trainData.jobId) throw new Error(trainData.error || "Gagal memulai training");

        let trainStatus = "";
        for (let i = 0; i < 600 && !cancelledRef.current; i++) {
          await sleep(4000);
          try {
            const r = await fetch(`/api/finetune/jobs/${encodeURIComponent(trainData.jobId)}`);
            if (r.ok) {
              const job = (await r.json()) as { status?: string; progress?: number };
              trainStatus = (job.status ?? "").toUpperCase();
              setStage("train", { detail: `${trainStatus} · ${Math.round(Number(job.progress) || 0)}%` });
              if (TRAIN_TERMINAL.has(trainStatus)) break;
            }
          } catch {
            /* keep polling */
          }
        }
        if (cancelledRef.current) return false;
        if (trainStatus !== "COMPLETE" && trainStatus !== "COMPLETED") {
          setStage("train", { status: "failed", detail: trainStatus || "gagal" });
          throw new Error("Training gagal — pipeline dihentikan.");
        }

        // v0.40.0: the training output IS the job (its adapter lives under the
        // job dir). The job id is the handle for export — no separate "fused"
        // model in a registry like v0.30.3 had.
        const jobId = trainData.jobId;
        out.fusedModelId = jobId;
        setStage("train", { status: "done", detail: "selesai" });

        // 2) EVAL ----------------------------------------------------------
        // Evaluate the FINE-TUNE itself: the eval endpoint merges the adapter
        // into the base locally and runs lm-eval on the merged model (the harness
        // can't load a LoRA adapter from HF).
        if (cfg.doEval) {
          setStage("eval", { status: "running", detail: "Merge + eval fine-tune…" });
          const evalRes = await fetch("/api/evals/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: jobId,
              fineTuned: true,
              benchmark: cfg.benchmark,
              limit: cfg.coverage / 100,
            }),
          });
          const evalData = (await evalRes.json()) as { jobId?: string; error?: string };
          if (!evalRes.ok || !evalData.jobId) {
            setStage("eval", { status: "failed", detail: evalData.error || "gagal" });
          } else {
            const score = await waitEval(evalData.jobId, cancelledRef);
            if (cancelledRef.current) return false;
            out.score = score;
            setStage("eval", {
              status: score == null ? "failed" : "done",
              detail: score == null ? "tanpa skor" : `${(score * 100).toFixed(1)}%`,
            });
          }
        }

        // 3) EXPORT GGUF ---------------------------------------------------
        if (cfg.doExport) {
          setStage("export", { status: "running", detail: "Merge → GGUF → Ollama…" });
          const expRes = await fetch("/api/finetune/export", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fusedModelId: jobId }),
          });
          const expData = (await expRes.json().catch(() => ({}))) as { ok?: boolean; error?: string };
          if (!expRes.ok || !expData.ok) {
            setStage("export", { status: "failed", detail: expData.error || "gagal" });
          } else {
            // Confirm the model landed in Ollama (the catalog flips `ready` true).
            const ft = await waitGgufReady(jobId, cancelledRef);
            if (cancelledRef.current) return false;
            out.ggufReady = Boolean(ft?.ready);
            out.loadModelId = ft?.loadModelId ?? null;
            setStage("export", {
              status: ft?.ready ? "done" : "failed",
              detail: ft?.ready ? "siap di-chat" : "GGUF tak terkonfirmasi",
            });
          }
        }

        setResult(out);
        return true;
      } catch (err) {
        if (!cancelledRef.current) {
          setError((err as Error).message);
          setResult(out);
        }
        return false;
      } finally {
        if (!cancelledRef.current) setRunning(false);
      }
    },
    [setStage]
  );

  return { running, stages, result, error, run };
}

type FineTuned = { name: string; fusedModelId: string; ready: boolean; loadModelId: string | null };

/** Find a fine-tune in the catalog by its train job id (fusedModelId). */
async function fetchFineTuned(jobId: string): Promise<FineTuned | null> {
  try {
    const res = await fetch("/api/models/catalog", { cache: "no-store" });
    const data = (await res.json()) as { fineTuned?: FineTuned[] };
    return (data.fineTuned ?? []).find((m) => m.fusedModelId === jobId) ?? null;
  } catch {
    return null;
  }
}

async function waitGgufReady(
  jobId: string,
  cancelledRef: { current: boolean }
): Promise<FineTuned | null> {
  for (let i = 0; i < 60 && !cancelledRef.current; i++) {
    const ft = await fetchFineTuned(jobId);
    if (ft?.ready) return ft;
    await sleep(3000);
  }
  return fetchFineTuned(jobId);
}

async function waitEval(jobId: string, cancelledRef: { current: boolean }): Promise<number | null> {
  for (let i = 0; i < 300 && !cancelledRef.current; i++) {
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
}
