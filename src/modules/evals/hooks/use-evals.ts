"use client";

import { useCallback, useEffect, useState } from "react";

import type { EvalJob, EvalOptions } from "@/lib/evals";

const EMPTY: EvalOptions = { models: [], benchmarks: [] };
const ACTIVE = new Set(["QUEUED", "RUNNING", "STARTED", "NOT_STARTED"]);
export const isEvalActive = (status: string) => ACTIVE.has(status.toUpperCase());

/**
 * Drives the Evals page: loads models + benchmarks, polls eval jobs while any
 * is running (and briefly after, so a just-finished score appears), and submits
 * new runs. Backed by Transformer Lab via the BFF.
 */
export function useEvals() {
  const [options, setOptions] = useState<EvalOptions>(EMPTY);
  const [jobs, setJobs] = useState<EvalJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/evals/jobs");
      const data = (await res.json()) as { jobs?: EvalJob[] };
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/evals/options").then((r) => r.json()),
      fetch("/api/evals/jobs").then((r) => r.json()),
    ])
      .then(([opts, jobsData]: [EvalOptions, { jobs?: EvalJob[] }]) => {
        if (cancelled) return;
        setOptions(opts ?? EMPTY);
        setJobs(Array.isArray(jobsData?.jobs) ? jobsData.jobs : []);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Poll while any job is active, plus one extra cycle after the last finishes
  // (the score is written just after COMPLETE). Keyed on the derived boolean (not
  // the whole `jobs` array) so the interval is created once per active/idle
  // transition; the interval id is local so cleanup can't race a shared ref.
  const shouldPoll =
    jobs.some((j) => isEvalActive(j.status)) ||
    jobs.some((j) => !isEvalActive(j.status) && j.scores.length === 0);
  useEffect(() => {
    if (!shouldPoll) return;
    const id = setInterval(loadJobs, 3000);
    return () => clearInterval(id);
  }, [shouldPoll, loadJobs]);

  const submit = useCallback(
    async (body: {
      model: string;
      modelArchitecture?: string;
      benchmark: string;
      limit: number;
      fineTuned?: boolean;
    }) => {
      setError(null);
      setSubmitting(true);
      try {
        const res = await fetch("/api/evals/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { jobId?: string; error?: string };
        if (!res.ok || !data.jobId) throw new Error(data.error || "Failed to start eval");
        await loadJobs();
        return true;
      } catch (err) {
        setError((err as Error).message);
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [loadJobs]
  );

  // --- Compare: run the SAME benchmark on several models, side by side. ---
  // Must run SEQUENTIALLY: the harness reads the model from the experiment's
  // foundation at *run* time, so queuing many at once would make them all read
  // whichever foundation was set last. So: submit one → wait for it to finish →
  // submit the next.
  const [comparing, setComparing] = useState(false);
  const [compareProgress, setCompareProgress] = useState<{ done: number; total: number } | null>(
    null
  );

  const pollUntilDone = useCallback(async (jobId: string) => {
    const terminal = new Set(["COMPLETE", "COMPLETED", "FAILED", "STOPPED", "CANCELLED"]);
    // Cap the wait so a stuck job can't hang the whole compare run (~10 min).
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch("/api/evals/jobs");
        const data = (await res.json()) as { jobs?: EvalJob[] };
        const job = (data.jobs ?? []).find((j) => j.id === jobId);
        setJobs(Array.isArray(data.jobs) ? data.jobs : []);
        if (job && terminal.has(job.status.toUpperCase())) return;
      } catch {
        /* keep polling */
      }
    }
  }, []);

  const submitCompare = useCallback(
    async (
      models: Array<{ id: string; architecture?: string; fineTuned?: boolean }>,
      benchmark: string,
      limit: number
    ) => {
      setError(null);
      setComparing(true);
      try {
        for (let i = 0; i < models.length; i++) {
          setCompareProgress({ done: i, total: models.length });
          const res = await fetch("/api/evals/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: models[i].id,
              modelArchitecture: models[i].architecture,
              benchmark,
              limit,
              fineTuned: models[i].fineTuned,
            }),
          });
          const data = (await res.json()) as { jobId?: string; error?: string };
          if (!res.ok || !data.jobId) throw new Error(data.error || "Failed to start eval");
          await loadJobs();
          await pollUntilDone(data.jobId);
        }
        setCompareProgress({ done: models.length, total: models.length });
        return true;
      } catch (err) {
        setError((err as Error).message);
        return false;
      } finally {
        setComparing(false);
        await loadJobs();
        setCompareProgress(null);
      }
    },
    [loadJobs, pollUntilDone]
  );

  return {
    options,
    jobs,
    loading,
    submitting,
    error,
    submit,
    comparing,
    compareProgress,
    submitCompare,
  };
}
