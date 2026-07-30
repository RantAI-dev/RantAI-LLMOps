"use client";

import type { GenRow } from "@/modules/generations/hooks/use-generations";

/**
 * Persisted output-comparison runs (localStorage). A finished comparison is saved
 * so it can be revisited / shown later WITHOUT re-running the models (loading two
 * models + answering every prompt takes minutes). Per-browser; capped so the store
 * can't grow without bound.
 */
export type GenHistoryEntry = {
  id: string;
  createdAt: number;
  baseLabel: string;
  ftLabel: string;
  rows: GenRow[];
};

const KEY = "nqllmops-gen-history-v1";
const MAX = 30;

export function loadGenHistory(): GenHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as GenHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(entries: GenHistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX)));
  } catch {
    // ignore quota errors
  }
}

/** Prepend a finished run and return the new (capped) list. */
export function saveGenRun(entry: Omit<GenHistoryEntry, "id" | "createdAt">): GenHistoryEntry[] {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const next = [{ ...entry, id, createdAt: Date.now() }, ...loadGenHistory()].slice(0, MAX);
  persist(next);
  return next;
}

export function deleteGenRun(id: string): GenHistoryEntry[] {
  const next = loadGenHistory().filter((e) => e.id !== id);
  persist(next);
  return next;
}

export function clearGenHistory(): GenHistoryEntry[] {
  persist([]);
  return [];
}
