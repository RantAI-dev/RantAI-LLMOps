"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { FinetuneOptions, TrainingJob } from "@/lib/finetune";

const EMPTY_OPTIONS: FinetuneOptions = { models: [], datasets: [] };

const ACTIVE = new Set(["QUEUED", "RUNNING", "STARTED", "NOT_STARTED"]);
export const isJobActive = (status: string) => ACTIVE.has(status.toUpperCase());

/**
 * Drives the Fine-tune page: loads form options, polls the job list while any
 * job is still running, and exposes a submit action. All backed by Transformer
 * Lab via the BFF.
 */
export function useFinetune() {
  const [options, setOptions] = useState<FinetuneOptions>(EMPTY_OPTIONS);
  const [jobs, setJobs] = useState<TrainingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/finetune/jobs");
      const data = (await res.json()) as { jobs?: TrainingJob[] };
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch {
      /* keep last jobs on a transient error */
    }
  }, []);

  // Initial load of options + jobs.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/finetune/options").then((r) => r.json()),
      fetch("/api/finetune/jobs").then((r) => r.json()),
    ])
      .then(([opts, jobsData]: [FinetuneOptions, { jobs?: TrainingJob[] }]) => {
        if (cancelled) return;
        setOptions(opts ?? EMPTY_OPTIONS);
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

  // Poll while any job is active.
  useEffect(() => {
    const anyActive = jobs.some((j) => isJobActive(j.status));
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (anyActive) {
      pollRef.current = setInterval(loadJobs, 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobs, loadJobs]);

  const refreshOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/finetune/options");
      setOptions((await res.json()) ?? EMPTY_OPTIONS);
    } catch {
      /* keep last options */
    }
  }, []);

  /** Create a prompt/completion dataset, then refresh the dataset list. */
  const createDataset = useCallback(
    async (name: string, rows: Array<{ prompt: string; completion: string }>) => {
      const res = await fetch("/api/datasets/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, rows }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error || "Could not create dataset");
      await refreshOptions();
      return data.id;
    },
    [refreshOptions]
  );

  const deleteDataset = useCallback(
    async (datasetId: string) => {
      await fetch("/api/datasets/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ datasetId }),
      }).catch(() => {});
      await refreshOptions();
    },
    [refreshOptions]
  );

  const stopJob = useCallback(
    async (id: string) => {
      await fetch(`/api/finetune/jobs/${id}/stop`, { method: "POST" }).catch(() => {});
      await loadJobs();
    },
    [loadJobs]
  );

  const deleteJob = useCallback(
    async (id: string) => {
      await fetch(`/api/finetune/jobs/${id}`, { method: "DELETE" }).catch(() => {});
      await loadJobs();
    },
    [loadJobs]
  );

  const submit = useCallback(
    async (body: Record<string, unknown>) => {
      setError(null);
      setSubmitting(true);
      try {
        const res = await fetch("/api/finetune/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { jobId?: string; error?: string };
        if (!res.ok || !data.jobId) throw new Error(data.error || "Failed to start fine-tune");
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

  return {
    options,
    jobs,
    loading,
    submitting,
    error,
    submit,
    createDataset,
    deleteDataset,
    stopJob,
    deleteJob,
    refreshJobs: loadJobs,
  };
}
