"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

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

  // Poll while any job is active. Keyed on the derived boolean (not the whole
  // `jobs` array) so the interval is created once per active/idle transition
  // instead of being torn down and rebuilt on every poll, and the interval id is
  // local to the effect (no shared ref to race between body and cleanup).
  const anyActive = jobs.some((j) => isJobActive(j.status));
  useEffect(() => {
    if (!anyActive) return;
    const id = setInterval(loadJobs, 3000);
    return () => clearInterval(id);
  }, [anyActive, loadJobs]);

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
      try {
        const res = await fetch("/api/datasets/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ datasetId }),
        });
        if (!res.ok) throw new Error();
      } catch {
        toast.error("Gagal menghapus dataset");
      }
      await refreshOptions();
    },
    [refreshOptions]
  );

  const stopJob = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/finetune/jobs/${id}/stop`, { method: "POST" });
        if (!res.ok) throw new Error();
      } catch {
        toast.error("Gagal menghentikan job");
      }
      await loadJobs();
    },
    [loadJobs]
  );

  const deleteJob = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/finetune/jobs/${id}`, { method: "DELETE" });
        if (!res.ok) throw new Error();
      } catch {
        toast.error("Gagal menghapus job");
      }
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
        toast.success("Fine-tune dimulai! Pantau progresnya di menu Tasks.");
        return true;
      } catch (err) {
        setError((err as Error).message);
        toast.error((err as Error).message || "Gagal memulai fine-tune");
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
