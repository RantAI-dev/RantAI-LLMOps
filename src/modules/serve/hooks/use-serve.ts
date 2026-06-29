"use client";

import { useCallback, useEffect, useState } from "react";

import {
  getActiveId,
  loadDeployments,
  makeDeployment,
  saveDeployments,
  setActiveId,
  type Deployment,
} from "@/modules/serve/lib/deployment-storage";

export type ServeModel = { id: string; name: string; isGguf: boolean };
export type ServeInfo = {
  baseUrl: string;
  teamId: string;
  /** Whether a real TL key is configured server-side. The key itself is never sent to the client. */
  hasKey: boolean;
  loaded: string | null;
  models: ServeModel[];
};

export type { Deployment };

const EMPTY: ServeInfo = { baseUrl: "", teamId: "", hasKey: false, loaded: null, models: [] };

/**
 * Drives the Deployments page: saved deployment configs (localStorage), the
 * lifecycle (deploy = load into VRAM, stop = unload), connection details for the
 * active deployment, and a live test. On one local GPU only one deployment is
 * active at a time.
 */
export function useServe() {
  const [info, setInfo] = useState<ServeInfo>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [activeId, setActiveIdState] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ id: string; action: "deploy" | "stop" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testReply, setTestReply] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const loadInfo = useCallback(async () => {
    try {
      const res = await fetch("/api/serve/info", { cache: "no-store" });
      const data = (await res.json()) as ServeInfo;
      setInfo(data ?? EMPTY);
      // If nothing is loaded server-side, no deployment is truly active.
      if (!data?.loaded) {
        setActiveId(null);
        setActiveIdState(null);
      }
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    // Read localStorage synchronously (not setState), then apply all state
    // inside the async callbacks — never synchronously in the effect body.
    const savedDeployments = loadDeployments();
    const savedActive = getActiveId();
    fetch("/api/serve/info", { cache: "no-store" })
      .then((r) => r.json() as Promise<ServeInfo>)
      .then((data) => {
        setDeployments(savedDeployments);
        setInfo(data ?? EMPTY);
        // A deployment is only truly active if TL still has a model loaded.
        setActiveIdState(data?.loaded ? savedActive : null);
        if (!data?.loaded) setActiveId(null);
        setLoading(false);
      })
      .catch(() => {
        setDeployments(savedDeployments);
        setActiveIdState(savedActive);
        setLoading(false);
      });
  }, []);

  const persist = useCallback((next: Deployment[]) => {
    setDeployments(next);
    saveDeployments(next);
  }, []);

  const addDeployment = useCallback(
    (name: string, modelId: string) => {
      const m = info.models.find((x) => x.id === modelId);
      if (!name.trim() || !m) return;
      const dep = makeDeployment({
        name: name.trim(),
        modelId,
        modelLabel: m.name,
        isGguf: m.isGguf,
      });
      persist([dep, ...deployments]);
    },
    [deployments, info.models, persist]
  );

  const removeDeployment = useCallback(
    (id: string) => {
      persist(deployments.filter((d) => d.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setActiveIdState(null);
      }
    },
    [activeId, deployments, persist]
  );

  /** Deploy = load this model into VRAM and mark it active (swaps out any other). */
  const deploy = useCallback(
    async (dep: Deployment) => {
      setError(null);
      setBusy({ id: dep.id, action: "deploy" });
      setTestReply(null);
      try {
        const res = await fetch("/api/models/load", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelId: dep.modelId }),
        });
        const data = (await res.json()) as { loaded?: string; error?: string };
        if (!res.ok || !data.loaded) throw new Error(data.error || "Gagal deploy");
        setActiveId(dep.id);
        setActiveIdState(dep.id);
        await loadInfo();
        return true;
      } catch (err) {
        setError((err as Error).message);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [loadInfo]
  );

  /** Stop the active deployment — unload from VRAM. */
  const stop = useCallback(async () => {
    if (!activeId) return false;
    setError(null);
    setBusy({ id: activeId, action: "stop" });
    try {
      const res = await fetch("/api/serve/stop", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Gagal stop");
      setActiveId(null);
      setActiveIdState(null);
      setTestReply(null);
      await loadInfo();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }, [activeId, loadInfo]);

  const test = useCallback(async (prompt: string) => {
    setError(null);
    setTesting(true);
    setTestReply(null);
    try {
      const res = await fetch("/api/serve/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Test gagal");
      setTestReply(data.reply ?? "");
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setTesting(false);
    }
  }, []);

  // A deployment is truly active only if it's marked active AND TL has a model loaded.
  const effectiveActiveId = info.loaded ? activeId : null;

  return {
    info,
    loading,
    deployments,
    activeId: effectiveActiveId,
    busy,
    error,
    testReply,
    testing,
    addDeployment,
    removeDeployment,
    deploy,
    stop,
    test,
  };
}
