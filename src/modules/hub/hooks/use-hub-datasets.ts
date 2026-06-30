"use client";

import { useEffect, useState } from "react";

import type { HubDataset } from "@/lib/hf-hub";

/** Debounced search of Hugging Face datasets via the BFF (`/api/hub/datasets`). */
export function useHubDatasets(search: string, sort: string) {
  const [datasets, setDatasets] = useState<HubDataset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (sort) params.set("sort", sort);
      fetch(`/api/hub/datasets?${params.toString()}`)
        .then((r) => r.json() as Promise<{ datasets?: HubDataset[]; error?: string }>)
        .then((d) => {
          if (cancelled) return;
          setDatasets(d.datasets ?? []);
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
  }, [search, sort]);

  return { datasets, loading, error };
}
