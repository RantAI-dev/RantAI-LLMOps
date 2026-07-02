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
import { computeSummaryStats, filterModels, generateId } from "@/modules/model-registry/lib/utils";
import {
  fetchModels,
  seedModels,
} from "@/modules/model-registry/services/model-registry-service";
import type {
  ModelFilters,
  RegistryModel,
  ToastMessage,
} from "@/modules/model-registry/types";

const defaultFilters: ModelFilters = {
  search: "",
  provider: "all",
  task: "all",
  status: "all",
  access: "all",
  compatibility: "all",
};

type ModelRegistryContextValue = {
  models: RegistryModel[];
  filters: ModelFilters;
  setFilters: React.Dispatch<React.SetStateAction<ModelFilters>>;
  resetFilters: () => void;
  filteredModels: RegistryModel[];
  summaryStats: ReturnType<typeof computeSummaryStats>;
  selectedModelId: string | null;
  setSelectedModelId: (id: string | null) => void;
  selectedModel: RegistryModel | null;
  archiveTargetId: string | null;
  setArchiveTargetId: (id: string | null) => void;
  archiveModel: (id: string) => void;
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
  const [filters, setFilters] = useState<ModelFilters>(defaultFilters);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [archiveTargetId, setArchiveTargetId] = useState<string | null>(null);

  const showToast = useCallback((message: Omit<ToastMessage, "id">) => {
    const options = message.description ? { description: message.description } : undefined;
    if (message.variant === "success") toast.success(message.title, options);
    else if (message.variant === "error") toast.error(message.title, options);
    else if (message.variant === "warning") toast.warning(message.title, options);
    else toast.info(message.title, options);
  }, []);

  const filteredModels = useMemo(() => filterModels(models, filters), [models, filters]);
  const summaryStats = useMemo(() => computeSummaryStats(models), [models]);
  const selectedModel = useMemo(
    () => (selectedModelId ? models.find((m) => m.id === selectedModelId) ?? null : null),
    [models, selectedModelId]
  );

  const resetFilters = useCallback(() => setFilters(defaultFilters), []);

  const archiveModel = useCallback(
    (id: string) => {
      const now = new Date().toISOString();
      setModels((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                status: "Archived" as const,
                updatedAt: now,
                auditLogs: [
                  {
                    id: generateId("audit"),
                    modelId: id,
                    action: "Archived",
                    actor: "Admin-NQR",
                    timestamp: now,
                    status: "Info" as const,
                    notes: "Model archived from registry.",
                  },
                  ...m.auditLogs,
                ],
              }
            : m
        )
      );
      setArchiveTargetId(null);
      if (selectedModelId === id) setSelectedModelId(null);
      showToast({ title: "Model archived", variant: "info" });
    },
    [selectedModelId, showToast]
  );

  const value = useMemo<ModelRegistryContextValue>(
    () => ({
      models,
      filters,
      setFilters,
      resetFilters,
      filteredModels,
      summaryStats,
      selectedModelId,
      setSelectedModelId,
      selectedModel,
      archiveTargetId,
      setArchiveTargetId,
      archiveModel,
      showToast,
      modelsLoading,
      modelsError,
      reloadModels,
    }),
    [
      models,
      filters,
      resetFilters,
      filteredModels,
      summaryStats,
      selectedModelId,
      selectedModel,
      archiveTargetId,
      archiveModel,
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
