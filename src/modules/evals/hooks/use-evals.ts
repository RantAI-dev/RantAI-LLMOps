"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { EvalJob, EvalOptions } from "@/lib/evals";

const EMPTY: EvalOptions = { models: [], benchmarks: [] };
// LAUNCHING/STOPPING are transitional TL phases — treat as active so they render
// with a spinner (not a green "done" badge) while the job settles.
const ACTIVE = new Set(["QUEUED", "RUNNING", "STARTED", "NOT_STARTED", "LAUNCHING", "STOPPING"]);
export const isEvalActive = (status: string) => ACTIVE.has(status.toUpperCase());
// Terminal-but-unsuccessful: these will never produce a score, so don't keep
// polling waiting for one.
const FAILED = new Set(["FAILED", "STOPPED", "CANCELLED", "ERROR"]);
export const isEvalFailed = (status: string) => FAILED.has(status.toUpperCase());

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
  // A background submit launched but its job has not appeared yet — for a
  // fine-tune the merge runs first, so there is a gap with no visible job. This
  // keeps the poll alive across that gap and lets the UI show a "menyiapkan" note.
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stops the compare poll loop from running / setState-ing after unmount.
  // Reset on mount too — under StrictMode the mount→cleanup→mount cycle would
  // otherwise leave this permanently true and short-circuit every compare.
  const cancelledRef = useRef(false);
  useEffect(() => {
    cancelledRef.current = false;
    return () => {
      cancelledRef.current = true;
    };
  }, []);

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

  // Poll while any job is active, plus one extra cycle after a job *completes*
  // without a score yet (it's written just after COMPLETE). A FAILED/CANCELLED
  // job legitimately has no score and never will, so it must NOT keep the poll
  // alive — otherwise the page polls every 3s forever. Keyed on the derived
  // boolean (not the whole `jobs` array) so the interval is created once per
  // active/idle transition; the interval id is local so cleanup can't race.
  const anyActive = jobs.some((j) => isEvalActive(j.status));
  // A completed job's score is written just after COMPLETE, so poll briefly for
  // it. A FAILED/CANCELLED job never gets a score (must not keep polling), and a
  // completed job whose score never arrives (e.g. no acc metric) is bounded below
  // so it can't poll forever either.
  const hasAwaitingScore = jobs.some(
    (j) => !isEvalActive(j.status) && !isEvalFailed(j.status) && j.scores.length === 0
  );
  const shouldPoll = preparing || anyActive || hasAwaitingScore;
  useEffect(() => {
    if (!shouldPoll) return;
    // When the ONLY reason to poll is an awaited score, stop after 30s so a score
    // that never arrives doesn't leave the page polling every 3s indefinitely.
    const awaitOnly = !preparing && !anyActive && hasAwaitingScore;
    const startedAt = Date.now();
    const id = setInterval(() => {
      if (awaitOnly && Date.now() - startedAt > 30_000) {
        clearInterval(id);
        return;
      }
      loadJobs();
    }, 3000);
    return () => clearInterval(id);
  }, [shouldPoll, preparing, anyActive, hasAwaitingScore, loadJobs]);

  // Hand off to normal polling once the submitted eval appears as an active job.
  useEffect(() => {
    if (!preparing) return;
    if (jobs.some((j) => isEvalActive(j.status))) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile to polled job state: hand off to active-job polling once the job appears
      setPreparing(false);
    }
  }, [preparing, jobs]);

  // Hard cap: if a background merge fails and no job ever appears, stop
  // "preparing" (and its polling) after 9 min. Keyed on `preparing` ONLY so the
  // 3s job poll doesn't re-arm this timer every tick (which would defeat it).
  useEffect(() => {
    if (!preparing) return;
    const cap = setTimeout(() => setPreparing(false), 9 * 60 * 1000);
    return () => clearTimeout(cap);
  }, [preparing]);

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
        // background: the (possibly minutes-long) adapter merge runs server-side
        // after the response, so the request returns at once instead of holding
        // the connection until a proxy kills it ("Failed to fetch"). The job
        // surfaces via polling, which `preparing` keeps alive until it appears.
        const res = await fetch("/api/evals/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, background: true }),
        });
        const data = (await res.json()) as { pending?: boolean; error?: string };
        if (!res.ok || !data.pending) throw new Error(data.error || "Failed to start eval");
        setPreparing(true);
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
      if (cancelledRef.current) return;
      await new Promise((r) => setTimeout(r, 3000));
      if (cancelledRef.current) return;
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

  // With a background submit the job appears asynchronously (after the merge),
  // so we don't get its id up front. Poll until a job id we didn't see before
  // shows up — compare runs one model at a time, so that's the one we launched.
  const waitForNewJobId = useCallback(async (exclude: Set<string>): Promise<string | null> => {
    for (let i = 0; i < 200; i++) {
      if (cancelledRef.current) return null;
      await new Promise((r) => setTimeout(r, 3000));
      if (cancelledRef.current) return null;
      try {
        const res = await fetch("/api/evals/jobs");
        const data = (await res.json()) as { jobs?: EvalJob[] };
        const list = data.jobs ?? [];
        setJobs(list);
        const fresh = list.find((j) => !exclude.has(j.id));
        if (fresh) return fresh.id;
      } catch {
        /* keep polling */
      }
    }
    return null;
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
          // Snapshot existing job ids so we can spot the one this submit creates.
          let before = new Set<string>();
          try {
            const r0 = await fetch("/api/evals/jobs");
            const d0 = (await r0.json()) as { jobs?: EvalJob[] };
            before = new Set((d0.jobs ?? []).map((j) => j.id));
          } catch {
            /* proceed with an empty snapshot */
          }
          // background: for a fine-tune the adapter merge runs server-side after
          // the response (minutes), so submitting synchronously would hold the
          // connection until a proxy kills it ("Failed to fetch"). Return at once,
          // then detect the job once it appears (compare is one-at-a-time).
          const res = await fetch("/api/evals/submit", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: models[i].id,
              modelArchitecture: models[i].architecture,
              benchmark,
              limit,
              fineTuned: models[i].fineTuned,
              background: true,
            }),
          });
          const data = (await res.json()) as { jobId?: string; pending?: boolean; error?: string };
          if (!res.ok || (!data.jobId && !data.pending)) {
            throw new Error(data.error || "Failed to start eval");
          }
          const jobId = data.jobId ?? (await waitForNewJobId(before));
          if (!jobId) {
            if (cancelledRef.current) return false;
            throw new Error("Eval did not start in time.");
          }
          await loadJobs();
          await pollUntilDone(jobId);
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
    [loadJobs, pollUntilDone, waitForNewJobId]
  );

  return {
    options,
    jobs,
    loading,
    submitting,
    preparing,
    error,
    submit,
    comparing,
    compareProgress,
    submitCompare,
  };
}
