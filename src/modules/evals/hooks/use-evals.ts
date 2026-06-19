"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
  // (the score is written just after COMPLETE).
  useEffect(() => {
    const anyActive = jobs.some((j) => isEvalActive(j.status));
    const scoresPending = jobs.some((j) => !isEvalActive(j.status) && j.scores.length === 0);
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (anyActive || scoresPending) {
      pollRef.current = setInterval(loadJobs, 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobs, loadJobs]);

  const submit = useCallback(
    async (body: { model: string; modelArchitecture?: string; benchmark: string; limit: number }) => {
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

  return { options, jobs, loading, submitting, error, submit };
}
