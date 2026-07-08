"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { addRun, clearRuns as clearRunsStore, loadRuns, type WorkflowRun } from "@/modules/workflows/lib/history";

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
  const [runs, setRuns] = useState<WorkflowRun[]>([]);

  const cancelledRef = useRef(false);
  // Mirror of `stages` readable inside the async run() to record the final outcome.
  const stagesRef = useRef<Stage[]>([]);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  // Load local history once after mount (avoids SSR/hydration mismatch).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot load from localStorage
    setRuns(loadRuns());
  }, []);

  const setStage = useCallback((key: StageKey, patch: Partial<Stage>) => {
    // Update the ref SYNCHRONOUSLY (not inside the async state updater) so the
    // history record built in run()'s `finally` sees the final "failed"/"done"
    // status — a React state updater would still be pending at that point.
    stagesRef.current = stagesRef.current.map((s) => (s.key === key ? { ...s, ...patch } : s));
    setStages(stagesRef.current);
  }, []);

  const clearRuns = useCallback(() => {
    clearRunsStore();
    setRuns([]);
  }, []);

  const run = useCallback(
    async (cfg: PipelineConfig) => {
      const startedAt = new Date().toISOString();
      setError(null);
      setResult(null);
      const init = initialStages(cfg.doEval, cfg.doExport);
      stagesRef.current = init;
      setStages(init);
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

        const jobId = trainData.jobId;

        // A job can "complete" (its process exits cleanly) while the trainer
        // errored INTERNALLY — e.g. the base-model download from HF timed out, so
        // no adapter was ever saved. The trainer prints a structured result line;
        // check it so we don't march on to eval/export with a phantom adapter.
        let trainLog = "";
        try {
          const logRes = await fetch(`/api/tasks/${encodeURIComponent(jobId)}/output`);
          trainLog = String(((await logRes.json()) as { output?: string })?.output ?? "");
        } catch {
          /* best-effort — if we can't read the log, trust the COMPLETE status */
        }
        if (/Training result:\s*\{'status':\s*'error'/.test(trainLog) || /Error loading model/.test(trainLog)) {
          setStage("train", { status: "failed", detail: "training error — cek log job" });
          throw new Error("Training error: model tidak terbentuk (lihat log). Pipeline dihentikan.");
        }

        // v0.40.0: the training output IS the job (its adapter lives under the
        // job dir). The job id is the handle for export — no separate "fused"
        // model in a registry like v0.30.3 had.
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
          // The export endpoint STREAMS SSE (`data: {stage,percent}` … then
          // `{done,tag}` or `{error}`) — reading it as JSON always failed and
          // mislabelled successful exports as "gagal". Consume the stream and
          // decide from its final event.
          const exp = await consumeExportStream(expRes, cancelledRef, (stage, percent) =>
            setStage("export", {
              status: "running",
              detail: percent != null ? `${stage} ${percent}%` : stage,
            })
          );
          if (cancelledRef.current) return false;
          if (exp.done && exp.tag) {
            out.ggufReady = true;
            out.loadModelId = exp.tag;
            setStage("export", { status: "done", detail: "siap di-chat" });
          } else if (exp.error) {
            setStage("export", { status: "failed", detail: exp.error });
          } else {
            // Stream cut off with no clear verdict — fall back to a catalog check.
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
        // Record the run (success OR failure) to local history — but not on cancel.
        if (!cancelledRef.current) {
          setRuns(addRun(buildRun(cfg, out, stagesRef.current, startedAt)));
          setRunning(false);
        }
      }
    },
    [setStage]
  );

  return { running, stages, result, error, run, runs, clearRuns };
}

/** Freeze the finished pipeline into a history record. */
function buildRun(
  cfg: PipelineConfig,
  out: PipelineResult,
  stages: Stage[],
  startedAt: string
): WorkflowRun {
  const failed = stages.some((s) => s.status === "failed");
  const anyDone = stages.some((s) => s.status === "done");
  return {
    id: startedAt,
    startedAt,
    finishedAt: new Date().toISOString(),
    baseModel: cfg.baseModel,
    dataset: cfg.dataset,
    adaptorName: out.adaptorName,
    epochs: cfg.epochs,
    benchmark: cfg.benchmark,
    coverage: cfg.coverage,
    stages: stages.map((s) => ({ key: s.key, label: s.label, status: s.status })),
    score: out.score,
    ggufReady: out.ggufReady,
    loadModelId: out.loadModelId,
    trainJobId: out.fusedModelId,
    overall: failed ? (anyDone ? "partial" : "failed") : "success",
  };
}

/**
 * Read the export endpoint's SSE stream to its verdict. Emits progress via
 * `onProgress` and returns `{done+tag}` on success or `{error}` on failure.
 */
async function consumeExportStream(
  res: Response,
  cancelledRef: { current: boolean },
  onProgress: (stage: string, percent?: number) => void
): Promise<{ done: boolean; tag: string | null; error: string | null }> {
  if (!res.ok || !res.body) return { done: false, tag: null, error: `HTTP ${res.status}` };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let done = false;
  let tag: string | null = null;
  let error: string | null = null;
  while (!cancelledRef.current) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      try {
        const ev = JSON.parse(line.slice(5).trim()) as {
          stage?: string;
          percent?: number;
          done?: boolean;
          tag?: string;
          error?: string;
        };
        if (ev.error) error = ev.error;
        else if (ev.done) {
          done = true;
          tag = ev.tag ?? null;
        } else if (ev.stage) onProgress(ev.stage, ev.percent);
      } catch {
        /* ignore a malformed SSE line */
      }
    }
  }
  return { done, tag, error };
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
