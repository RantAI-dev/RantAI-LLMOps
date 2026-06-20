"use client";

import { useCallback, useEffect, useState } from "react";

export type ServeModel = { id: string; name: string; isGguf: boolean };
export type ServeInfo = {
  baseUrl: string;
  teamId: string;
  /** Whether a real TL key is configured server-side. The key itself is never sent to the client. */
  hasKey: boolean;
  loaded: string | null;
  models: ServeModel[];
};

const EMPTY: ServeInfo = { baseUrl: "", teamId: "", hasKey: false, loaded: null, models: [] };

/**
 * Drives the Serve page: connection details for the served model, switching
 * which model is served (= loaded into VRAM in Transformer Lab), and a live test
 * call. The served model is the same engine the chat playground uses.
 */
export function useServe() {
  const [info, setInfo] = useState<ServeInfo>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testReply, setTestReply] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

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
    fetch("/api/serve/info", { cache: "no-store" })
      .then((r) => r.json() as Promise<ServeInfo>)
      .then((data) => {
        if (cancelled) return;
        setInfo(data ?? EMPTY);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Serve a different model (loads it into VRAM, swapping out the current one). */
  const serveModel = useCallback(
    async (modelId: string) => {
      setError(null);
      setSwitching(modelId);
      setTestReply(null);
      try {
        const res = await fetch("/api/models/load", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelId }),
        });
        const data = (await res.json()) as { loaded?: string; error?: string };
        if (!res.ok || !data.loaded) throw new Error(data.error || "Gagal memuat model");
        await loadInfo();
        return true;
      } catch (err) {
        setError((err as Error).message);
        return false;
      } finally {
        setSwitching(null);
      }
    },
    [loadInfo]
  );

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

  return { info, loading, switching, error, testReply, testing, serveModel, test };
}
