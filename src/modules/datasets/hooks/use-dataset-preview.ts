"use client";

import { useEffect, useState } from "react";

export type DatasetPreview = { columns: string[]; rows: Array<Record<string, string>> };
export type PreviewState = "loading" | "ready" | "empty" | "error";

/**
 * Fetches real rows for a dataset from Transformer Lab via `/api/datasets/preview`.
 * Returns `empty` for datasets TL doesn't have (e.g. the mock fixtures) so the
 * caller can fall back to its sample rows.
 */
export function useDatasetPreview(datasetId: string) {
  const [state, setState] = useState<PreviewState>("loading");
  const [preview, setPreview] = useState<DatasetPreview>({ columns: [], rows: [] });

  // State starts at "loading" (and the detail drawer mounts fresh per dataset),
  // so we only setState inside the async callbacks — never synchronously in the
  // effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/datasets/preview?id=${encodeURIComponent(datasetId)}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<DatasetPreview>)
      .then((data) => {
        if (cancelled) return;
        const ok = Array.isArray(data.rows) && data.rows.length > 0;
        setPreview(ok ? data : { columns: [], rows: [] });
        setState(ok ? "ready" : "empty");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  return { state, preview };
}
