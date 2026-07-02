"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { CatalogModel } from "@/lib/models-catalog";

/**
 * Downloaded (Ollama-resident) models for the Hub's storage manager. Reads the
 * `servable` list from the model catalog and deletes via `/api/models/delete`.
 */
export function useDownloadedModels() {
  const [models, setModels] = useState<CatalogModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Manual refresh (event handler → sync setState is fine here).
  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/models/catalog", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ servable?: CatalogModel[] }>)
      .then((data) => {
        setModels(data.servable ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // On-mount fetch (setState lands in the async `.then`, never sync in the body).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/models/catalog", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ servable?: CatalogModel[] }>)
      .then((data) => {
        if (!cancelled) {
          setModels(data.servable ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const remove = useCallback(async (id: string) => {
    setDeleting(id);
    try {
      const res = await fetch("/api/models/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelIds: [id] }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Gagal menghapus model");
      toast.success(`"${id}" dihapus`);
      setModels((prev) => prev.filter((m) => m.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal menghapus model");
    } finally {
      setDeleting(null);
    }
  }, []);

  return { models, loading, deleting, remove, reload: load };
}
