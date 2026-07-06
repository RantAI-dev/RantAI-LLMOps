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

import { FINETUNE_EXPERIMENT } from "@/lib/tl-constants";

const STORAGE_KEY = "nqr.activeExperiment";

type ActiveExperimentValue = {
  /** The experiment new runs (fine-tune / eval) launch into. */
  activeExperiment: string;
  setActiveExperiment: (id: string) => void;
};

const ActiveExperimentContext = createContext<ActiveExperimentValue | null>(null);

/**
 * The "active experiment" — a single grouping every new run launches into,
 * chosen once (in the header) rather than per-form. Persisted to localStorage so
 * it survives reloads. Matches how Transformer Lab itself scopes work.
 */
export function ActiveExperimentProvider({ children }: { children: ReactNode }) {
  const [activeExperiment, setActive] = useState(FINETUNE_EXPERIMENT);

  // Restore the persisted choice on mount. Guarded — storage access can throw
  // (privacy mode); a bare read would crash the whole app chrome (this wraps it).
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      /* storage blocked — keep the default */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot restore from localStorage
    if (saved) setActive(saved);
  }, []);

  const setActiveExperiment = useCallback((id: string) => {
    const value = id.trim() || FINETUNE_EXPERIMENT;
    setActive(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* ignore quota / disabled storage */
    }
  }, []);

  const value = useMemo(
    () => ({ activeExperiment, setActiveExperiment }),
    [activeExperiment, setActiveExperiment]
  );

  return (
    <ActiveExperimentContext.Provider value={value}>{children}</ActiveExperimentContext.Provider>
  );
}

export function useActiveExperiment() {
  const ctx = useContext(ActiveExperimentContext);
  if (!ctx) {
    throw new Error("useActiveExperiment must be used within ActiveExperimentProvider");
  }
  return ctx;
}
