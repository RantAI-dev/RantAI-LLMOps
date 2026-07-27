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

import { runOptimistic } from "@/lib/optimistic";
import { useResourceFetch } from "@/lib/use-resource-fetch";
import { fetchTasks, seedTasks } from "@/modules/tasks/services/tasks-service";
import { latestRun, taskProgress, taskStatus } from "@/modules/tasks/lib/utils";
import type {
  Task,
  TaskFilters,
} from "@/modules/tasks/types";

const defaultTaskFilters: TaskFilters = {
  search: "",
  type: "all",
  status: "all",
  computeTarget: "all",
  sort: "newest",
};

/** Returns `value` delayed by `delayMs`, resetting the timer on each change. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

type LlmOpsContextValue = {
  tasks: Task[];
  taskFilters: TaskFilters;
  setTaskFilters: React.Dispatch<React.SetStateAction<TaskFilters>>;
  resetTaskFilters: () => void;
  filteredTasks: Task[];
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  selectedTask: Task | null;
  deleteTask: (id: string) => void;
  tasksLoading: boolean;
  tasksError: boolean;
  reloadTasks: () => void;
};

const LlmOpsContext = createContext<LlmOpsContextValue | null>(null);

export function LlmOpsProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>(seedTasks);
  const { isLoading: tasksLoading, isError: tasksError, reload: reloadTasks } = useResourceFetch(
    setTasks,
    fetchTasks,
    { always: true }
  );
  const [taskFilters, setTaskFilters] = useState<TaskFilters>(defaultTaskFilters);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  // `taskFilters.search` updates on every keystroke so the (controlled) search
  // input stays responsive, but the actual filtering runs off a debounced copy —
  // this keeps the filter+sort pass and the resulting `filteredTasks` array from
  // being recomputed on every keystroke (only the discrete selects apply live).
  const debouncedSearch = useDebouncedValue(taskFilters.search, 250);

  const filteredTasks = useMemo(() => {
    let result = [...tasks];
    const q = debouncedSearch.trim().toLowerCase();

    if (q) {
      result = result.filter((t) => t.name.toLowerCase().includes(q));
    }
    if (taskFilters.type !== "all") {
      result = result.filter((t) => t.type === taskFilters.type);
    }
    if (taskFilters.status !== "all") {
      result = result.filter((t) => taskStatus(t) === taskFilters.status);
    }
    if (taskFilters.computeTarget !== "all") {
      result = result.filter((t) => t.computeTarget === taskFilters.computeTarget);
    }

    result.sort((a, b) => {
      switch (taskFilters.sort) {
        case "oldest":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "progress":
          return taskProgress(b) - taskProgress(a);
        case "duration":
          return (latestRun(b)?.durationMs ?? 0) - (latestRun(a)?.durationMs ?? 0);
        case "newest":
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });

    return result;
  }, [
    tasks,
    debouncedSearch,
    taskFilters.type,
    taskFilters.status,
    taskFilters.computeTarget,
    taskFilters.sort,
  ]);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId]
  );

  const deleteTask = useCallback(
    (id: string) => {
      // Optimistically drop the row; on failure re-sync from TL + toast.
      void runOptimistic({
        apply: () => {
          setTasks((prev) => prev.filter((t) => t.id !== id));
          setSelectedTaskId((current) => (current === id ? null : current));
        },
        request: () => fetch(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" }),
        rollback: () => reloadTasks(),
        errorMessage: "Failed to delete the task on the server",
      });
    },
    [reloadTasks]
  );

  // Live progress comes from the real Transformer Lab job state, not a fake
  // animation: while any task is active we silently re-fetch every few seconds
  // (no loading flash). The poll stops itself when nothing is running, so an
  // idle dashboard makes no background requests.
  const hasActiveTask = useMemo(
    () =>
      tasks.some((t) => {
        const s = taskStatus(t);
        return s === "Running" || s === "Queued" || s === "Retrying";
      }),
    [tasks]
  );
  useEffect(() => {
    if (!hasActiveTask) return;
    const interval = window.setInterval(() => reloadTasks(true), 5000);
    return () => window.clearInterval(interval);
  }, [hasActiveTask, reloadTasks]);

  const resetTaskFilters = useCallback(() => setTaskFilters(defaultTaskFilters), []);

  const value = useMemo<LlmOpsContextValue>(
    () => ({
      tasks,
      taskFilters,
      setTaskFilters,
      resetTaskFilters,
      filteredTasks,
      selectedTaskId,
      setSelectedTaskId,
      selectedTask,
      deleteTask,
      tasksLoading,
      tasksError,
      reloadTasks,
    }),
    [
      tasks,
      taskFilters,
      resetTaskFilters,
      filteredTasks,
      selectedTaskId,
      selectedTask,
      deleteTask,
      tasksLoading,
      tasksError,
      reloadTasks,
    ]
  );

  return <LlmOpsContext.Provider value={value}>{children}</LlmOpsContext.Provider>;
}

export function useLlmOps() {
  const ctx = useContext(LlmOpsContext);
  if (!ctx) {
    throw new Error("useLlmOps must be used within LlmOpsProvider");
  }
  return ctx;
}
