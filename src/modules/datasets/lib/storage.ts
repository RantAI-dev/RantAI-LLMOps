import type { Dataset } from "@/modules/datasets/types";

const STORAGE_KEY = "nqllmops-datasets-v1";

export function loadDatasetsFromStorage(fallback: Dataset[]): Dataset[] {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Dataset[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function saveDatasetsToStorage(datasets: Dataset[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(datasets));
  } catch {
    // ignore quota errors in demo
  }
}
