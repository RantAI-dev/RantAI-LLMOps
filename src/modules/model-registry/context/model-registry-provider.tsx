"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { useResourceFetch } from "@/lib/use-resource-fetch";
import { computeSummaryStats } from "@/modules/model-registry/lib/utils";
import {
  fetchModels,
  seedModels,
} from "@/modules/model-registry/services/model-registry-service";
import type {
  RegistryModel,
  ToastMessage,
} from "@/modules/model-registry/types";

// NOTE: search/filter state lives locally in the consuming page (models-page's
// ModelBrowser), not here — keeping it out of this shared value means typing in
// the filter bar no longer re-renders every data consumer (summary cards, detail
// page). This context now only carries model data + actions.
type ModelRegistryContextValue = {
  models: RegistryModel[];
  summaryStats: ReturnType<typeof computeSummaryStats>;
  selectedModelId: string | null;
  setSelectedModelId: (id: string | null) => void;
  selectedModel: RegistryModel | null;
  deleteTargetId: string | null;
  setDeleteTargetId: (id: string | null) => void;
  deleteModel: (id: string) => Promise<void>;
  showToast: (toast: Omit<ToastMessage, "id">) => void;
  modelsLoading: boolean;
  modelsError: boolean;
  reloadModels: () => void;
};

const ModelRegistryContext = createContext<ModelRegistryContextValue | null>(null);

export function ModelRegistryProvider({ children }: { children: ReactNode }) {
  const [models, setModels] = useState<RegistryModel[]>(seedModels);
  const { isLoading: modelsLoading, isError: modelsError, reload: reloadModels } = useResourceFetch(
    setModels,
    fetchModels,
    { always: true }
  );
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const showToast = useCallback((message: Omit<ToastMessage, "id">) => {
    const options = message.description ? { description: message.description } : undefined;
    if (message.variant === "success") toast.success(message.title, options);
    else if (message.variant === "error") toast.error(message.title, options);
    else if (message.variant === "warning") toast.warning(message.title, options);
    else toast.info(message.title, options);
  }, []);

  const summaryStats = useMemo(() => computeSummaryStats(models), [models]);
  const selectedModel = useMemo(
    () => (selectedModelId ? models.find((m) => m.id === selectedModelId) ?? null : null),
    [models, selectedModelId]
  );

  // Real delete: removes the model from Ollama (and its GGUF blob) via the BFF,
  // then re-fetches the registry so the row actually disappears — no fake local
  // "archived" flag that a refresh would undo.
  const deleteModel = useCallback(
    async (id: string) => {
      // Close the confirm dialog + clear selection up front so the destructive
      // button can't be double-clicked during the request — a second delete of an
      // already-removed tag would 502 and fire a spurious error toast.
      setDeleteTargetId(null);
      if (selectedModelId === id) setSelectedModelId(null);
      try {
        const res = await fetch("/api/models/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelIds: [id] }),
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error || "Failed to delete model");
        showToast({ title: "Model deleted", variant: "success" });
        reloadModels();
      } catch (err) {
        showToast({
          title: "Failed to delete model",
          description: (err as Error).message,
          variant: "error",
        });
      }
    },
    [selectedModelId, showToast, reloadModels]
  );

  const value = useMemo<ModelRegistryContextValue>(
    () => ({
      models,
      summaryStats,
      selectedModelId,
      setSelectedModelId,
      selectedModel,
      deleteTargetId,
      setDeleteTargetId,
      deleteModel,
      showToast,
      modelsLoading,
      modelsError,
      reloadModels,
    }),
    [
      models,
      summaryStats,
      selectedModelId,
      selectedModel,
      deleteTargetId,
      deleteModel,
      showToast,
      modelsLoading,
      modelsError,
      reloadModels,
    ]
  );

  return (
    <ModelRegistryContext.Provider value={value}>{children}</ModelRegistryContext.Provider>
  );
}

export function useModelRegistryContext() {
  const ctx = useContext(ModelRegistryContext);
  if (!ctx) throw new Error("useModelRegistryContext must be used within ModelRegistryProvider");
  return ctx;
}
