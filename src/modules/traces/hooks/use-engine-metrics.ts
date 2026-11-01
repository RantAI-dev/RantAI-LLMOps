"use client";

import { useEffect, useRef, useState } from "react";

import type { EngineMetricsReport } from "@/lib/engine-metrics";

export type LiveEngine = EngineMetricsReport & {
  /** Output tokens per second over the last poll interval; null until two snapshots exist. */
  outTokS: number | null;
};

const POLL_MS = 5000;

/**
 * Polls /api/serve/metrics every 5 s while the tab is visible. Counters are
 * totals since the engine started, so the output rate comes from the difference
 * between two snapshots (a restarted engine resets its counters: shown as 0).
 */
export function useEngineMetrics() {
  const [engines, setEngines] = useState<LiveEngine[] | null>(null);
  const prev = useRef<{ ts: number; gen: Record<string, number> } | null>(null);

  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/serve/metrics", { cache: "no-store" });
        if (!res.ok) return;
        const d = (await res.json()) as { ts: number; engines: EngineMetricsReport[] };
        const before = prev.current;
        const gen: Record<string, number> = {};
        const next = d.engines.map((e): LiveEngine => {
          const now = e.metrics?.generationTokens;
          if (now !== undefined) gen[e.id] = now;
          const then = before?.gen[e.id];
          const dt = before ? (d.ts - before.ts) / 1000 : 0;
          const outTokS = now !== undefined && then !== undefined && dt > 0 ? Math.max(0, now - then) / dt : null;
          return { ...e, outTokS };
        });
        prev.current = { ts: d.ts, gen };
        if (!stopped) setEngines(next);
      } catch {
        /* keep the last snapshot */
      }
    };
    const first = setTimeout(() => void tick(), 0);
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  return engines;
}
