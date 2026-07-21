"use client";

import { useCallback, useEffect, useState } from "react";

// Type-only import: erased at build, so this client hook never pulls the
// server-only engine registry (or its Ollama/network deps) into the bundle.
import type { EngineInfo } from "@/lib/inference-engines";

export type { EngineInfo };

/**
 * The inference engines and their live status, from `/api/serve/info`.
 *
 * Shared by the Deployments status panel and the chat engine picker so both read
 * one source. `configured` engines have a base URL (vLLM is opt-in via env);
 * `available` ones are reachable right now.
 */
export function useEngines(): { engines: EngineInfo[]; loading: boolean; reload: () => void } {
  const [engines, setEngines] = useState<EngineInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/serve/info", { cache: "no-store" });
      const data = (await res.json()) as { engines?: EngineInfo[] };
      setEngines(Array.isArray(data.engines) ? data.engines : []);
    } catch {
      setEngines([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot load on mount; state is only set once the request resolves
    void reload();
  }, [reload]);

  return { engines, loading, reload };
}
