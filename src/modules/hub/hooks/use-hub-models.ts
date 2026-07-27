"use client";

import { useCallback, useEffect, useState } from "react";

import type { HubModel } from "@/lib/hf-hub";

export type HubModelFormat = "gguf" | "safetensors" | "all";

/**
 * Debounced search of Hugging Face models via the BFF. Fetches only the selected
 * format, or merges chat-ready GGUF and trainable safetensors results for `all`.
 */
export function useHubModels(
  search: string,
  task: string,
  sort: string,
  format: HubModelFormat
) {
  const [models, setModels] = useState<HubModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (task) params.set("task", task);
      if (sort) params.set("sort", sort);

      const ggufReq: Promise<{ models?: HubModel[]; error?: string }> =
        format === "safetensors"
          ? Promise.resolve({ models: [] })
          : fetch(`/api/hub/models?${params.toString()}`).then((r) => r.json());

      const stParams = new URLSearchParams();
      if (search) stParams.set("q", search);
      if (sort) stParams.set("sort", sort);
      const stReq: Promise<{ models?: HubModel[]; error?: string }> =
        format === "gguf"
          ? Promise.resolve({ models: [] })
          : fetch(`/api/hub/base-models?${stParams.toString()}`).then((r) => r.json());

      Promise.all([ggufReq, stReq])
        .then(([gguf, st]) => {
          if (cancelled) return;
          const seen = new Set<string>();
          const merged = [...(gguf.models ?? []), ...(st.models ?? [])].filter((m) =>
            seen.has(m.id) ? false : (seen.add(m.id), true)
          );
          setModels(merged);
          setError(gguf.error ?? st.error ?? null);
          setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          setError("Gagal memuat dari Hugging Face");
          setLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, task, sort, format, revision]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);

  return { models, loading, error, reload };
}
