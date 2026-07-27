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
import type { Dataset } from "@/modules/datasets/types";

type DatasetsContextValue = {
  datasets: Dataset[];
  getDatasetById: (id: string) => Dataset | undefined;
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

  // Cache the real list to localStorage for an instant next-visit paint.
  useEffect(() => {
    saveDatasetsToStorage(datasets);
  }, [datasets]);

  const getDatasetById = useCallback(
    (id: string) => datasets.find((d) => d.id === id),
    [datasets]
  );

  const value = useMemo<DatasetsContextValue>(
    () => ({
      datasets,
      getDatasetById,
      datasetsLoading,
      datasetsError,
      reloadDatasets,
    }),
    [datasets, getDatasetById, datasetsLoading, datasetsError, reloadDatasets]
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
