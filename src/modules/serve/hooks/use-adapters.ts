"use client";

import { useCallback, useEffect, useState } from "react";

export type AvailableAdapter = { jobId: string; path: string; base: string };

export type AdapterState = {
  /** vLLM has a base URL (engine is opt-in via env). */
  configured: boolean;
  /** vLLM answered — its models (base + adapters) are live. */
  reachable: boolean;
  /** The served base model id (adapters attach on top of it). */
  base: string | null;
  /** Adapter names currently served — what a client can route to by `model`. */
  served: string[];
  /** Trained adapters found on disk that can be attached (best effort). */
  available: AvailableAdapter[];
};

const EMPTY: AdapterState = { configured: false, reachable: false, base: null, served: [], available: [] };

/**
 * The vLLM base + its LoRA adapters, with attach/detach actions.
 *
 * Reads `/api/adapters` (served + on-disk). `busy` holds the name currently being
 * acted on (or "__form__" for the attach form) so the UI can disable just that row;
 * `error` carries vLLM's own message on failure. Every action reloads on success.
 */
export function useAdapters() {
  const [state, setState] = useState<AdapterState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/adapters", { cache: "no-store" });
      const d = (await res.json()) as Partial<AdapterState>;
      setState({
        configured: Boolean(d.configured),
        reachable: Boolean(d.reachable),
        base: d.base ?? null,
        served: Array.isArray(d.served) ? d.served : [],
        available: Array.isArray(d.available) ? d.available : [],
      });
    } catch {
      setState(EMPTY);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot load on mount
    void reload();
  }, [reload]);

  const act = useCallback(
    async (action: "load" | "unload", name: string, path: string | undefined, busyKey: string) => {
      setBusy(busyKey);
      setError(null);
      try {
        const res = await fetch("/api/adapters", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, name, path }),
        });
        const d = (await res.json()) as { error?: string };
        if (!res.ok) {
          setError(d.error ?? `Could not ${action} the adapter.`);
          return false;
        }
        await reload();
        return true;
      } catch {
        setError(`Could not ${action} the adapter.`);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [reload]
  );

  const attach = useCallback((name: string, path: string) => act("load", name, path, "__form__"), [act]);
  const detach = useCallback((name: string) => act("unload", name, undefined, name), [act]);
  const clearError = useCallback(() => setError(null), []);

  return { ...state, loading, busy, error, clearError, reload, attach, detach };
}
