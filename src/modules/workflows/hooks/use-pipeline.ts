"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { addRun, clearRuns as clearRunsStore, loadRuns, type WorkflowRun } from "@/modules/workflows/lib/history";
import { CACHE_VERSION, computeConfigHash } from "@/lib/pipeline-cache";

/**
 * One-click LLMOps pipeline: fine-tune → eval → export GGUF, run automatically
 * in sequence. App-orchestrated over the proven BFF routes (not TL's native
 * workflow engine), so it reuses exactly the paths that already work and gives
 * full control over progress/results.
 *
 * Flyte-inspired hardening (all opt-out-able, non-breaking):
 *  - CACHING: an identical config that already produced an adapter skips training
 *    and reuses it (verified against the model catalog first).
 *  - AUTO-RETRY + TIMEOUT: each stage retries on *recoverable* failures (flaky HF
 *    base-model download, transient TL/network hiccups) with backoff, and gives up
 *    on genuine failures/timeouts instead of looping.
 *  - RESUME: a partial run (adapter trained, eval/export failed) can re-enter at the
 *    failed stage, reusing the trained adapter.
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
  /** Skip the cache lookup and force a fresh train (Flyte's `overwrite_cache`). */
  ignoreCache?: boolean;
};

const TRAIN_TERMINAL = new Set(["COMPLETE", "COMPLETED", "FAILED", "STOPPED", "CANCELLED"]);
const EVAL_TERMINAL = new Set(["COMPLETE", "COMPLETED", "FAILED", "STOPPED", "CANCELLED"]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Per-stage poll caps double as timeouts (poll interval × count). Exhausting one is
// a "timed out" failure, not a reason to blindly relaunch a possibly-still-running job.
const TRAIN_MAX_POLLS = 600; // ×4s ≈ 40 min
const MAX_TRAIN_RETRIES = 2; // recoverable (flaky HF download) only
const MAX_STAGE_RETRIES = 2; // eval submit / export

/** A failure that is worth retrying (transient): network blips, a flaky HF
 *  base-model download, a TL/proxy hiccup. Genuine failures throw a plain Error. */
class RecoverableError extends Error {}

/** Log/error signatures that indicate a TRANSIENT cause worth retrying (flaky HF
 *  download, network/proxy hiccup, a transient 5xx). Anything else — a bad dataset,
 *  a missing pad token, OOM, a config error — is DETERMINISTIC and must NOT be
 *  retried (retrying just re-burns GPU on the same failure). */
const RECOVERABLE_SIGNATURE =
  /timed?\s*out|time-?out|connection (reset|refused|aborted|error)|read timed out|failed to (download|fetch|connect)|max retries exceeded|temporarily unavailable|httperror|proxyerror|connectionerror|readtimeout|incomplete read|network (error|is unreachable)|\b(502|503|504)\b/i;

function initialStages(doEval: boolean, doExport: boolean): Stage[] {
  return [
    { key: "train", label: "Fine-tune", status: "pending" },
    { key: "eval", label: "Eval", status: doEval ? "pending" : "skipped" },
    { key: "export", label: "Export GGUF", status: doExport ? "pending" : "skipped" },
  ];
}

function stageStatusOf(run: WorkflowRun, key: StageKey): StageStatus | undefined {
  return run.stages.find((s) => s.key === key)?.status as StageStatus | undefined;
}

/** Newest prior run whose training inputs match `hash` and whose adapter (train
 *  stage) actually completed — the cache candidate. `runs` is already newest-first. */
function findCacheHit(runs: WorkflowRun[], hash: string): WorkflowRun | null {
  return (
    runs.find(
      (r) =>
        r.configHash === hash &&
        r.cacheVersion === CACHE_VERSION &&
        Boolean(r.trainJobId) &&
        stageStatusOf(r, "train") === "done"
    ) ?? null
  );
}

/** Retry `fn` while it throws a RecoverableError, up to `max` times, with backoff. */
async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { max: number; cancelledRef: { current: boolean }; onRetry: (n: number, err: Error) => void }
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      if (opts.cancelledRef.current) throw e;
      if (e instanceof RecoverableError && attempt < opts.max) {
        opts.onRetry(attempt + 1, e as Error);
        await sleep(Math.min(15000, 5000 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

/** One training attempt: submit → poll → verify the adapter was actually saved.
 *  Throws RecoverableError for transient failures (retryable) and a plain Error
 *  for genuine failures/timeouts. Returns the train job id on success. */
async function trainOnce(
  cfg: PipelineConfig,
  signal: AbortSignal,
  cancelledRef: { current: boolean },
  setStage: (key: StageKey, patch: Partial<Stage>) => void
): Promise<string> {
  setStage("train", { status: "running", detail: "Submitting job…" });
  let trainRes: Response;
  try {
    trainRes = await fetch("/api/finetune/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseModel: cfg.baseModel,
        baseModelArchitecture: cfg.baseModelArchitecture,
        dataset: cfg.dataset,
        adaptorName: cfg.adaptorName,
        epochs: cfg.epochs,
      }),
      signal,
    });
  } catch (e) {
    // A thrown fetch = network error → transient, worth retrying.
    throw new RecoverableError((e as Error).message || "network error submitting training");
  }
  const trainData = (await trainRes.json().catch(() => ({}))) as { jobId?: string; error?: string };
  let jobId: string;
  if (trainRes.ok && trainData.jobId) {
    jobId = trainData.jobId;
  } else if (trainRes.status >= 500) {
    throw new RecoverableError(trainData.error || `submit failed (${trainRes.status})`); // transient server error
  } else {
    throw new Error(trainData.error || "Failed to start training"); // bad request/config → deterministic, no retry
  }

  let trainStatus = "";
  let polls = 0;
  for (; polls < TRAIN_MAX_POLLS && !cancelledRef.current; polls++) {
    await sleep(4000);
    try {
      const r = await fetch(`/api/finetune/jobs/${encodeURIComponent(jobId)}`, { signal });
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
  if (cancelledRef.current) throw new Error("cancelled");
  if (polls >= TRAIN_MAX_POLLS && !TRAIN_TERMINAL.has(trainStatus)) {
    throw new Error("Training timed out."); // don't auto-relaunch a possibly-live long job
  }
  if (trainStatus !== "COMPLETE" && trainStatus !== "COMPLETED") {
    throw new Error(`Training failed (${trainStatus || "unknown"}).`);
  }

  // A job can "complete" (its process exits cleanly) while the trainer errored
  // INTERNALLY. Read the log and classify: a TRANSIENT cause (flaky HF download,
  // network) is retryable; a DETERMINISTIC one (bad dataset schema, missing pad
  // token, OOM, config) is not — retrying it would just re-burn GPU on the same error.
  let trainLog = "";
  try {
    const logRes = await fetch(`/api/tasks/${encodeURIComponent(jobId)}/output`, { signal });
    trainLog = String(((await logRes.json()) as { output?: string })?.output ?? "");
  } catch {
    /* best-effort — if we can't read the log, trust the COMPLETE status */
  }
  const trainErrored =
    /Training result:\s*\{'status':\s*'error'/.test(trainLog) || /Error loading model/.test(trainLog);
  if (trainErrored) {
    if (RECOVERABLE_SIGNATURE.test(trainLog)) {
      throw new RecoverableError("transient error during training (network / HF download)");
    }
    // Surface the ACTUAL deterministic reason so the user sees WHY (and we don't retry).
    const m =
      trainLog.match(/'error':\s*"([^"]{1,180})"/) ||
      trainLog.match(/Error loading model:\s*([^\n]{1,180})/) ||
      trainLog.match(/Training failed:\s*([^\n]{1,180})/);
    throw new Error(m ? m[1].trim() : "Training error (see job log).");
  }

  // v0.40.0: the training output IS the job (its adapter lives under the job dir).
  setStage("train", { status: "done", detail: "done" });
  return jobId;
}

/** Submit an eval on the trained adapter. Throws RecoverableError on a transient
 *  submit failure so it can be retried. */
async function submitEvalOnce(jobId: string, cfg: PipelineConfig, signal: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/evals/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: jobId, fineTuned: true, benchmark: cfg.benchmark, limit: cfg.coverage / 100 }),
      signal,
    });
  } catch (e) {
    throw new RecoverableError((e as Error).message || "network error submitting eval");
  }
  const data = (await res.json().catch(() => ({}))) as { jobId?: string; error?: string };
  if (res.ok && data.jobId) return data.jobId;
  if (res.status >= 500) throw new RecoverableError(data.error || `eval submit ${res.status}`); // transient
  // A logical error like "this fine-tune has no adapter" is deterministic — don't retry.
  throw new Error(data.error || "eval submit failed");
}

/** One export attempt (SSE → verdict, with catalog fallback). Writes the tag into
 *  `out` on success; throws RecoverableError if the export didn't confirm. */
async function exportOnce(
  jobId: string,
  signal: AbortSignal,
  cancelledRef: { current: boolean },
  setStage: (key: StageKey, patch: Partial<Stage>) => void,
  out: PipelineResult
): Promise<void> {
  const expRes = await fetch("/api/finetune/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fusedModelId: jobId }),
    signal,
  });
  const exp = await consumeExportStream(expRes, cancelledRef, (stage, percent) =>
    setStage("export", { status: "running", detail: percent != null ? `${stage} ${percent}%` : stage })
  );
  if (cancelledRef.current) throw new Error("cancelled");
  if (exp.done && exp.tag) {
    out.ggufReady = true;
    out.loadModelId = exp.tag;
    setStage("export", { status: "done", detail: "ready to chat" });
    return;
  }
  if (exp.error) {
    // A reported export error (merge/convert failed) is usually deterministic; only
    // retry when it looks transient (network/timeout).
    if (RECOVERABLE_SIGNATURE.test(exp.error)) throw new RecoverableError(exp.error);
    throw new Error(exp.error);
  }
  // Stream cut off with no clear verdict — fall back to a catalog check.
  const ft = await waitGgufReady(jobId, cancelledRef, signal);
  if (cancelledRef.current) throw new Error("cancelled");
  if (ft?.ready) {
    out.ggufReady = true;
    out.loadModelId = ft.loadModelId;
    setStage("export", { status: "done", detail: "ready to chat" });
    return;
  }
  throw new RecoverableError("GGUF not confirmed");
}

export function usePipeline() {
  const [running, setRunning] = useState(false);
  const [stages, setStages] = useState<Stage[]>([]);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);

  const cancelledRef = useRef(false);
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const stagesRef = useRef<Stage[]>([]);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadRuns().then((r) => {
      if (!cancelled) setRuns(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setStage = useCallback((key: StageKey, patch: Partial<Stage>) => {
    stagesRef.current = stagesRef.current.map((s) => (s.key === key ? { ...s, ...patch } : s));
    setStages(stagesRef.current);
  }, []);

  const clearRuns = useCallback(() => {
    void clearRunsStore();
    setRuns([]);
  }, []);

  const run = useCallback(
    async (cfg: PipelineConfig, opts?: { reuseRun?: WorkflowRun }) => {
      if (runningRef.current) return false;
      runningRef.current = true;
      cancelledRef.current = false;
      const startedAt = new Date().toISOString();
      const configHash = computeConfigHash(cfg);
      setError(null);
      setResult(null);
      const init = initialStages(cfg.doEval, cfg.doExport);
      stagesRef.current = init;
      setStages(init);
      setRunning(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const signal = controller.signal;
      const out: PipelineResult = {
        adaptorName: cfg.adaptorName,
        fusedModelId: null,
        score: null,
        ggufReady: false,
        loadModelId: null,
      };
      let cached = false;

      try {
        // 1) TRAIN — reuse a cached adapter if one matches, else train (with retry).
        let reuseRun: WorkflowRun | null = opts?.reuseRun ?? null;
        if (!reuseRun && !cfg.ignoreCache) {
          setStage("train", { status: "running", detail: "Checking cache…" });
          // Fetch fresh (not the stale closure list) so the cache is correct across sessions.
          reuseRun = findCacheHit(await loadRuns(), configHash);
        }

        let jobId: string | null = null;
        if (reuseRun?.trainJobId) {
          setStage("train", { status: "running", detail: "Verifying cached adapter…" });
          const ft = await fetchFineTuned(reuseRun.trainJobId, signal);
          if (ft) {
            jobId = reuseRun.trainJobId;
            cached = true;
            setStage("train", { status: "done", detail: "♻️ reused (cache)" });
          } else {
            // Cached adapter is gone — fall back to a fresh train + don't reuse downstream.
            reuseRun = null;
          }
        }
        if (!jobId) {
          jobId = await resolveTrainJob(cfg, signal, cancelledRef, setStage);
        }
        if (cancelledRef.current) return false;
        out.fusedModelId = jobId;

        // 2) EVAL — reuse a matching cached score, else evaluate (with submit-retry).
        if (cfg.doEval) {
          const reuseEval =
            reuseRun &&
            stageStatusOf(reuseRun, "eval") === "done" &&
            reuseRun.score != null &&
            reuseRun.benchmark === cfg.benchmark &&
            reuseRun.coverage === cfg.coverage;
          if (reuseEval && reuseRun) {
            out.score = reuseRun.score;
            setStage("eval", { status: "done", detail: `♻️ cache · ${((reuseRun.score ?? 0) * 100).toFixed(1)}%` });
          } else {
            setStage("eval", { status: "running", detail: "Merge + evaluate fine-tune…" });
            try {
              const evalJobId = await withRetry(() => submitEvalOnce(jobId!, cfg, signal), {
                max: MAX_STAGE_RETRIES,
                cancelledRef,
                onRetry: (n) => setStage("eval", { status: "running", detail: `retry ${n}/${MAX_STAGE_RETRIES}…` }),
              });
              const score = await waitEval(evalJobId, cancelledRef, signal);
              if (cancelledRef.current) return false;
              out.score = score;
              setStage("eval", {
                status: score == null ? "failed" : "done",
                detail: score == null ? "no score" : `${(score * 100).toFixed(1)}%`,
              });
            } catch (e) {
              if (cancelledRef.current) return false;
              setStage("eval", { status: "failed", detail: (e as Error).message.slice(0, 50) || "failed" });
            }
          }
        }

        // 3) EXPORT GGUF — reuse a cached tag, else export (with retry).
        if (cfg.doExport) {
          const reuseExport =
            reuseRun && stageStatusOf(reuseRun, "export") === "done" && reuseRun.ggufReady && Boolean(reuseRun.loadModelId);
          if (reuseExport && reuseRun) {
            out.ggufReady = true;
            out.loadModelId = reuseRun.loadModelId;
            setStage("export", { status: "done", detail: "♻️ cache · ready to chat" });
          } else {
            setStage("export", { status: "running", detail: "Merge → GGUF → Ollama…" });
            try {
              await withRetry(() => exportOnce(jobId!, signal, cancelledRef, setStage, out), {
                max: 1,
                cancelledRef,
                onRetry: (n) => setStage("export", { status: "running", detail: `retry ${n}/1…` }),
              });
            } catch (e) {
              if (cancelledRef.current) return false;
              setStage("export", { status: "failed", detail: (e as Error).message.slice(0, 50) || "failed" });
            }
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
        runningRef.current = false;
        if (!cancelledRef.current) {
          setRunning(false);
          const rec = buildRun(cfg, out, stagesRef.current, startedAt, configHash, cached);
          setRuns((prev) => [rec, ...prev].slice(0, 50));
          void addRun(rec).then((saved) => {
            if (saved) setRuns(saved);
          });
        }
      }
    },
    [setStage]
  );

  /** Resume a partial/failed run: reuse its trained adapter and re-run the stages
   *  that didn't succeed. Only meaningful when an adapter was actually trained. */
  const resume = useCallback(
    (r: WorkflowRun) => {
      const cfg: PipelineConfig = {
        baseModel: r.baseModel,
        dataset: r.dataset,
        adaptorName: r.adaptorName,
        epochs: r.epochs,
        benchmark: r.benchmark,
        coverage: r.coverage,
        doEval: r.requestedStages?.eval ?? r.stages.some((s) => s.key === "eval" && s.status !== "skipped"),
        doExport: r.requestedStages?.export ?? r.stages.some((s) => s.key === "export" && s.status !== "skipped"),
      };
      return run(cfg, { reuseRun: r });
    },
    [run]
  );

  return { running, stages, result, error, run, resume, runs, clearRuns };
}

/** Cache-lookup + retry wrapper around training; marks the stage failed on give-up. */
async function resolveTrainJob(
  cfg: PipelineConfig,
  signal: AbortSignal,
  cancelledRef: { current: boolean },
  setStage: (key: StageKey, patch: Partial<Stage>) => void
): Promise<string> {
  try {
    return await withRetry(() => trainOnce(cfg, signal, cancelledRef, setStage), {
      max: MAX_TRAIN_RETRIES,
      cancelledRef,
      onRetry: (n, err) =>
        setStage("train", { status: "running", detail: `retry ${n}/${MAX_TRAIN_RETRIES} — ${err.message.slice(0, 40)}` }),
    });
  } catch (e) {
    if (!cancelledRef.current) {
      setStage("train", { status: "failed", detail: (e as Error).message.slice(0, 60) || "failed" });
    }
    throw e;
  }
}

/** Freeze the finished pipeline into a history record. */
function buildRun(
  cfg: PipelineConfig,
  out: PipelineResult,
  stages: Stage[],
  startedAt: string,
  configHash: string,
  cached: boolean
): WorkflowRun {
  const failed = stages.some((s) => s.status === "failed");
  const anyDone = stages.some((s) => s.status === "done");
  return {
    id: crypto.randomUUID(),
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
    configHash,
    cacheVersion: CACHE_VERSION,
    requestedStages: { eval: cfg.doEval, export: cfg.doExport },
    cached,
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
  try {
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
  } finally {
    void reader.cancel().catch(() => {});
  }
  return { done, tag, error };
}

type FineTuned = { name: string; fusedModelId: string; ready: boolean; loadModelId: string | null };

/** Find a fine-tune in the catalog by its train job id (fusedModelId). */
async function fetchFineTuned(jobId: string, signal?: AbortSignal): Promise<FineTuned | null> {
  try {
    const res = await fetch("/api/models/catalog", { cache: "no-store", signal });
    const data = (await res.json()) as { fineTuned?: FineTuned[] };
    return (data.fineTuned ?? []).find((m) => m.fusedModelId === jobId) ?? null;
  } catch {
    return null;
  }
}

async function waitGgufReady(
  jobId: string,
  cancelledRef: { current: boolean },
  signal?: AbortSignal
): Promise<FineTuned | null> {
  for (let i = 0; i < 60 && !cancelledRef.current; i++) {
    const ft = await fetchFineTuned(jobId, signal);
    if (ft?.ready) return ft;
    await sleep(3000);
  }
  return fetchFineTuned(jobId, signal);
}

async function waitEval(
  jobId: string,
  cancelledRef: { current: boolean },
  signal?: AbortSignal
): Promise<number | null> {
  for (let i = 0; i < 300 && !cancelledRef.current; i++) {
    await sleep(3000);
    let data: {
      jobs?: Array<{ id: string; status: string; scores: Array<{ type: string; score: number }> }>;
    };
    try {
      const res = await fetch("/api/evals/jobs", { signal });
      data = await res.json();
    } catch {
      continue;
    }
    try {
      const job = (data.jobs ?? []).find((j) => j.id === jobId);
      if (job && EVAL_TERMINAL.has(job.status.toUpperCase())) {
        const acc = job.scores.find((s) => s.type.toLowerCase() === "acc") ?? job.scores[0];
        return acc ? acc.score : null;
      }
    } catch {
      return null;
    }
  }
  return null;
}
