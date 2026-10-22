"use client";

import { useCallback, useEffect, useState } from "react";

import type { DecisionServerState, DeployableDecisionJob } from "@/lib/decision-server";

const EMPTY: DecisionServerState = {
  configured: false,
  reachable: false,
  adminEnabled: false,
  models: [],
  maxModels: null,
};

/**
 * The decision server's state (served models) and the finished decision jobs that could be deployed.
 * `busy` is the name or job id of an operation in flight; loading an 8B model takes a minute or
 * more, so the card must show it and not look frozen.
 */
export function useDecision() {
  const [server, setServer] = useState<DecisionServerState>(EMPTY);
  const [jobs, setJobs] = useState<DeployableDecisionJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/decision/models", { cache: "no-store" });
      const d = (await res.json()) as { server?: DecisionServerState; jobs?: DeployableDecisionJob[] };
      setServer(d.server ?? EMPTY);
      setJobs(d.jobs ?? []);
    } catch {
      /* keep the last state on a transient error */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void reload();
  }, [reload]);

  const run = useCallback(
    async (key: string, call: () => Promise<Response>): Promise<boolean> => {
      setBusy(key);
      setError(null);
      try {
        const res = await call();
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error || `Request failed (${res.status})`);
        }
        await reload();
        return true;
      } catch (err) {
        setError((err as Error).message);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [reload]
  );

  const deploy = useCallback(
    (jobId: string, opts: { name?: string; loadIn4bit?: boolean } = {}) =>
      run(jobId, () =>
        fetch("/api/decision/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId, ...opts }),
        })
      ),
    [run]
  );

  const unload = useCallback(
    (name: string) => run(name, () => fetch(`/api/decision/models/${encodeURIComponent(name)}`, { method: "DELETE" })),
    [run]
  );

  return { server, jobs, loading, busy, error, clearError: () => setError(null), reload, deploy, unload };
}
