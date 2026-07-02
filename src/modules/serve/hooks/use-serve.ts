"use client";

import { useCallback, useEffect, useState } from "react";

import { makeDeployment, type Deployment } from "@/modules/serve/lib/deployment";

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

type StoreState = { deployments: Deployment[]; activeId: string | null };

/**
 * Drives the Deployments page. Saved deployment configs live SERVER-SIDE
 * (`/api/serve/deployments`) so the list is shared across every browser/device/
 * user on this app instance. The lifecycle is real: deploy = load into VRAM,
 * stop = unload; on one local GPU only one deployment is active at a time, and a
 * deployment is only "active" if Transformer Lab still has that model loaded.
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

  /** Persist the full deployment store server-side, then reflect it locally. */
  const persist = useCallback(async (next: StoreState) => {
    setDeployments(next.deployments);
    setActiveIdState(next.activeId);
    try {
      await fetch("/api/serve/deployments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
    } catch {
      /* best-effort; local state already updated */
    }
  }, []);

  const loadInfo = useCallback(async () => {
    try {
      const res = await fetch("/api/serve/info", { cache: "no-store" });
      const data = (await res.json()) as ServeInfo;
      setInfo(data ?? EMPTY);
    } catch {
      /* keep last */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/serve/deployments", { cache: "no-store" })
        .then((r) => r.json() as Promise<StoreState>)
        .catch(() => ({ deployments: [], activeId: null }) as StoreState),
      fetch("/api/serve/info", { cache: "no-store" })
        .then((r) => r.json() as Promise<ServeInfo>)
        .catch(() => EMPTY),
    ]).then(([store, serveInfo]) => {
      if (cancelled) return;
      setDeployments(store.deployments ?? []);
      setInfo(serveInfo ?? EMPTY);
      // A deployment is only truly active if TL still has a model loaded.
      setActiveIdState(serveInfo?.loaded ? (store.activeId ?? null) : null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
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
      void persist({ deployments: [dep, ...deployments], activeId });
    },
    [deployments, activeId, info.models, persist]
  );

  const removeDeployment = useCallback(
    (id: string) => {
      void persist({
        deployments: deployments.filter((d) => d.id !== id),
        activeId: activeId === id ? null : activeId,
      });
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
        await persist({ deployments, activeId: dep.id });
        await loadInfo();
        return true;
      } catch (err) {
        setError((err as Error).message);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [deployments, loadInfo, persist]
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
      setTestReply(null);
      await persist({ deployments, activeId: null });
      await loadInfo();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }, [activeId, deployments, loadInfo, persist]);

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
