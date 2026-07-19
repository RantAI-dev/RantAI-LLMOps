"use client";

import { useEffect, useState } from "react";

import type { HubModel } from "@/lib/hf-hub";

/**
 * Debounced search of Hugging Face models via the BFF. Always the GGUF
 * (chat-ready) repos from `/api/hub/models`; when `includeSafetensors` is on,
 * also the safetensors fine-tune bases from `/api/hub/base-models`, merged and
 * tagged by `format` so nothing is silently hidden. A new query supersedes the
 * in-flight one (guarded `cancelled` flag).
 */
export function useHubModels(
  search: string,
  task: string,
  sort: string,
  includeSafetensors: boolean
) {
  const [models, setModels] = useState<HubModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (task) params.set("task", task);
      if (sort) params.set("sort", sort);

      const ggufReq = fetch(`/api/hub/models?${params.toString()}`).then(
        (r) => r.json() as Promise<{ models?: HubModel[]; error?: string }>
      );
      // Safetensors bases are best-effort: a failure there must not blank out
      // the GGUF results, so it resolves to an empty list on error.
      const stReq: Promise<{ models?: HubModel[] }> = includeSafetensors
        ? fetch(`/api/hub/base-models?q=${encodeURIComponent(search)}`)
            .then((r) => r.json() as Promise<{ models?: HubModel[] }>)
            .catch(() => ({ models: [] }))
        : Promise.resolve({ models: [] });

      Promise.all([ggufReq, stReq])
        .then(([gguf, st]) => {
          if (cancelled) return;
          const seen = new Set<string>();
          const merged = [...(gguf.models ?? []), ...(st.models ?? [])].filter((m) =>
            seen.has(m.id) ? false : (seen.add(m.id), true)
          );
          setModels(merged);
          setError(gguf.error ?? null);
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
  }, [search, task, sort, includeSafetensors]);

  return { models, loading, error };
}
