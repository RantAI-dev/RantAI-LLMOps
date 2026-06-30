"use client";

import { useEffect, useState } from "react";

import type { HubModel } from "@/lib/hf-hub";

/**
 * Debounced search of Hugging Face GGUF models via the BFF (`/api/hub/models`).
 * A new query supersedes the in-flight one (guarded `cancelled` flag).
 */
export function useHubModels(search: string, task: string, sort: string) {
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
      fetch(`/api/hub/models?${params.toString()}`)
        .then((r) => r.json() as Promise<{ models?: HubModel[]; error?: string }>)
        .then((d) => {
          if (cancelled) return;
          setModels(d.models ?? []);
          setError(d.error ?? null);
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
  }, [search, task, sort]);

  return { models, loading, error };
}
