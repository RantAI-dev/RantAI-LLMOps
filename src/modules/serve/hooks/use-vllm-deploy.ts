"use client";

import { useCallback, useEffect, useState } from "react";

export type VllmAdapter = { name: string; path: string };
export type VllmDeployment = {
  jobId: string;
  baseModel: string;
  servedName: string;
  port: number;
  gpuUtil: string;
  maxModelLen: string;
  quant: string;
  adapters: VllmAdapter[];
  deployedAt: number;
};
export type VllmStatus = {
  deployment: VllmDeployment | null;
  status: string;
  servedUrl: string | null;
};
export type DeployBody = {
  baseModel: string;
  servedName?: string;
  adapters?: VllmAdapter[];
  gpuUtil?: string;
  maxModelLen?: string;
  quant?: string;
  port?: number;
};

/** Poll + control the single vLLM serving deployment (via /api/serve/vllm). */
export function useVllmDeploy() {
  const [data, setData] = useState<VllmStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/serve/vllm", { cache: "no-store" });
      setData((await r.json()) as VllmStatus);
    } catch {
      /* keep last */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000); // reflect WAITING → RUNNING as the task starts
    return () => clearInterval(t);
  }, [refresh]);

  const deploy = useCallback(
    async (body: DeployBody): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const r = await fetch("/api/serve/vllm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const d = (await r.json()) as { error?: string };
        if (!r.ok) throw new Error(d.error || "Deploy failed");
        await refresh();
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const stop = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      await fetch("/api/serve/vllm/stop", { method: "POST" });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return { data, loading, busy, error, setError, deploy, stop, refresh };
}
