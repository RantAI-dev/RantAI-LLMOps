"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { CatalogModel, ModelCatalog } from "@/lib/models-catalog";
import { pullModelWithProgress } from "@/lib/pull-progress";

const EMPTY: ModelCatalog = {
  loaded: null,
  downloaded: [],
  recommended: [],
  fineTuned: [],
  servable: [],
  ollamaRecommended: [],
};

export type CatalogBusy = {
  id: string;
  action: "load" | "download" | "export" | "delete";
  /** Download progress 0–100 (null until Ollama reports a total). */
  percent?: number | null;
} | null;

async function getCatalog(): Promise<ModelCatalog> {
  try {
    const res = await fetch("/api/models/catalog");
    return (await res.json()) as ModelCatalog;
  } catch {
    return EMPTY;
  }
}

/**
 * Drives the model picker: fetches the catalog from the BFF and exposes actions
 * to switch (load) and download models. A 6 GB GPU holds one model at a time,
 * so loading swaps the active one — actions are serialized via `busy`.
 */
export function useModelCatalog(onLoaded?: (servedModel: string) => void) {
  const [catalog, setCatalog] = useState<ModelCatalog>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<CatalogBusy>(null);
  const [error, setError] = useState<string | null>(null);

  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  }, [onLoaded]);

  // On-mount fetch. setState only fires in the async `.then` (never synchronously
  // in the effect body) and is guarded against post-unmount writes.
  useEffect(() => {
    let cancelled = false;
    getCatalog().then((data) => {
      if (cancelled) return;
      setCatalog(data);
      setLoading(false);
      if (data.loaded) onLoadedRef.current?.(data.loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Re-fetch and return the catalog (called from event handlers). */
  const refresh = useCallback(async () => {
    const data = await getCatalog();
    setCatalog(data);
    return data;
  }, []);

  const load = useCallback(
    async (model: CatalogModel, adaptor?: string) => {
      setError(null);
      setBusy({ id: adaptor ?? model.id, action: "load" });
      try {
        const res = await fetch("/api/models/load", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelId: model.id, adaptor }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error || "Failed to load model");
        const next = await refresh();
        if (next.loaded) onLoadedRef.current?.(next.loaded);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  const downloadAndLoad = useCallback(
    async (model: CatalogModel) => {
      setError(null);
      setBusy({ id: model.id, action: "download", percent: null });
      try {
        await pullModelWithProgress(model.hfRepo ?? model.id, (percent) =>
          setBusy((b) => (b && b.id === model.id ? { ...b, percent } : b))
        );
        await refresh();
        await load(model);
      } catch (err) {
        setError((err as Error).message);
        setBusy(null);
      }
    },
    [refresh, load]
  );

  /** Export a fused fine-tuned model to GGUF so it becomes loadable. */
  const exportModel = useCallback(
    async (fusedModelId: string) => {
      setError(null);
      setBusy({ id: fusedModelId, action: "export" });
      try {
        const res = await fetch("/api/finetune/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fusedModelId }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error || "Export failed");
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  /** Delete a fine-tuned model: the fused model and its GGUF export. */
  const deleteFineTuned = useCallback(
    async (fusedModelId: string, loadModelId?: string | null) => {
      setError(null);
      setBusy({ id: fusedModelId, action: "delete" });
      try {
        const res = await fetch("/api/models/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelIds: [fusedModelId, loadModelId].filter(Boolean) }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error || "Delete failed");
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  return {
    catalog,
    loading,
    busy,
    error,
    refresh,
    load,
    downloadAndLoad,
    exportModel,
    deleteFineTuned,
  };
}
