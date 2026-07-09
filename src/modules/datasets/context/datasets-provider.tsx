"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useResourceFetch } from "@/lib/use-resource-fetch";
import { fetchDatasets, seedDatasets } from "@/modules/datasets/services/datasets-service";
import { saveDatasetsToStorage } from "@/modules/datasets/lib/storage";
import { generateActivityId, updateDataset } from "@/modules/datasets/lib/utils";
import type { Dataset, DatasetFilters } from "@/modules/datasets/types";

const defaultFilters: DatasetFilters = {
  search: "",
  datasetType: "all",
  source: "all",
  validationStatus: "all",
  sort: "updated",
};

type DatasetsContextValue = {
  datasets: Dataset[];
  filters: DatasetFilters;
  setFilters: React.Dispatch<React.SetStateAction<DatasetFilters>>;
  resetFilters: () => void;
  filteredDatasets: Dataset[];
  getDatasetById: (id: string) => Dataset | undefined;
  archiveDataset: (id: string) => void;
  datasetsLoading: boolean;
  datasetsError: boolean;
  reloadDatasets: () => void;
};

const DatasetsContext = createContext<DatasetsContextValue | null>(null);

export function DatasetsProvider({ children }: { children: ReactNode }) {
  const [datasets, setDatasets] = useState<Dataset[]>(seedDatasets);
  const {
    isLoading: datasetsLoading,
    isError: datasetsError,
    reload: reloadDatasets,
  } = useResourceFetch(setDatasets, fetchDatasets, { always: true });
  const [filters, setFilters] = useState<DatasetFilters>(defaultFilters);

  // Cache the real list to localStorage for an instant next-visit paint.
  useEffect(() => {
    saveDatasetsToStorage(datasets);
  }, [datasets]);

  const getDatasetById = useCallback(
    (id: string) => datasets.find((d) => d.id === id),
    [datasets]
  );

  const filteredDatasets = useMemo(() => {
    let result = datasets.filter((d) => d.validationStatus !== "Archived");
    const q = filters.search.trim().toLowerCase();

    if (q) {
      result = result.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.description.toLowerCase().includes(q) ||
          d.owner.toLowerCase().includes(q) ||
          d.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    if (filters.datasetType !== "all") {
      result = result.filter((d) => d.datasetType === filters.datasetType);
    }
    if (filters.source !== "all") {
      result = result.filter((d) => d.source === filters.source);
    }
    if (filters.validationStatus !== "all") {
      result = result.filter((d) => d.validationStatus === filters.validationStatus);
    }

    result.sort((a, b) => {
      switch (filters.sort) {
        case "newest":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "oldest":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "name":
          return a.name.localeCompare(b.name);
        case "usage":
          return b.usageCount - a.usageCount;
        case "updated":
        default:
          return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime();
      }
    });

    return result;
  }, [datasets, filters]);

  const resetFilters = useCallback(() => setFilters(defaultFilters), []);

  const archiveDataset = useCallback((id: string) => {
    const now = new Date().toISOString();
    setDatasets((prev) =>
      updateDataset(prev, id, (d) => ({
        ...d,
        validationStatus: "Archived",
        lastUpdated: now,
        activityLog: [
          {
            id: generateActivityId(),
            timestamp: now,
            actor: "Admin-RantAI",
            activity: "Dataset archived",
            description: `${d.name} moved to archive`,
          },
          ...d.activityLog,
        ],
      }))
    );
  }, []);

  const value = useMemo<DatasetsContextValue>(
    () => ({
      datasets,
      filters,
      setFilters,
      resetFilters,
      filteredDatasets,
      getDatasetById,
      archiveDataset,
      datasetsLoading,
      datasetsError,
      reloadDatasets,
    }),
    [
      datasets,
      filters,
      resetFilters,
      filteredDatasets,
      getDatasetById,
      archiveDataset,
      datasetsLoading,
      datasetsError,
      reloadDatasets,
    ]
  );

  return (
    <DatasetsContext.Provider value={value}>{children}</DatasetsContext.Provider>
  );
}

export function useDatasets() {
  const ctx = useContext(DatasetsContext);
  if (!ctx) {
    throw new Error("useDatasets must be used within DatasetsProvider");
  }
  return ctx;
}
