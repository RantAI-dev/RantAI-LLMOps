"use client";

import { useCallback, useEffect, useState } from "react";

import type { InferenceStats } from "@/lib/inference-log-store";
import { fetchTraces, type TraceEvent } from "@/modules/traces/services/traces-service";

/**
 * Page-local loader for the Traces view: fetches the recent request rows + the
 * aggregate summary in one round-trip, exposes a `refresh` for the manual reload
 * button, and re-fetches when `limit` changes.
 */
export function useTraces(limit = 200) {
  const [traces, setTraces] = useState<TraceEvent[]>([]);
  const [stats, setStats] = useState<InferenceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchTraces(limit);
      setTraces(data.traces);
      setStats(data.stats);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  // Kick the initial load (and re-load on `limit` change) via a 0ms defer so the
  // synchronous setState inside `refresh` doesn't run in the effect body — the
  // codebase's accepted way around the set-state-in-effect lint.
  useEffect(() => {
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [refresh]);

  return { traces, stats, loading, error, refresh };
}
