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
import { appendRunLog } from "@/modules/tasks/lib/run-engine";
import type {
  Task,
  TaskFilters,
  TaskRun,
} from "@/modules/tasks/types";

const defaultTaskFilters: TaskFilters = {
  search: "",
  type: "all",
  status: "all",
  computeTarget: "all",
  sort: "newest",
};

type LlmOpsContextValue = {
  tasks: Task[];
  taskFilters: TaskFilters;
  setTaskFilters: React.Dispatch<React.SetStateAction<TaskFilters>>;
  resetTaskFilters: () => void;
  filteredTasks: Task[];
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  selectedTask: Task | null;
  stopTask: (id: string) => void;
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

  const filteredTasks = useMemo(() => {
    let result = [...tasks];
    const q = taskFilters.search.trim().toLowerCase();

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
  }, [tasks, taskFilters]);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId]
  );

  /** Replace the latest (active) run of a task via an updater. */
  const updateLatestRun = useCallback(
    (id: string, updater: (run: TaskRun, task: Task) => TaskRun) => {
      setTasks((prev) =>
        prev.map((task) => {
          if (task.id !== id || task.runs.length === 0) return task;
          const [latest, ...rest] = task.runs;
          return { ...task, runs: [updater(latest, task), ...rest] };
        })
      );
    },
    []
  );

  const stopTask = useCallback(
    (id: string) => {
      // Optimistically mark the run cancelled; on failure re-sync from TL + toast.
      void runOptimistic({
        apply: () =>
          updateLatestRun(id, (run) => {
            if (run.status !== "Running" && run.status !== "Paused" && run.status !== "Retrying") {
              return run;
            }
            return appendRunLog(
              {
                ...run,
                status: "Cancelled",
                finishedAt: new Date().toISOString(),
                outputStatus: "None",
                timeline: run.timeline.map((s) =>
                  s.id === "completed" ? { ...s, label: "Cancelled", status: "failed" as const } : s
                ),
              },
              "Run cancelled by user"
            );
          }),
        request: () => fetch(`/api/tasks/${encodeURIComponent(id)}/stop`, { method: "POST" }),
        rollback: () => reloadTasks(),
        errorMessage: "Gagal menghentikan task di server",
      });
    },
    [updateLatestRun, reloadTasks]
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
        errorMessage: "Gagal menghapus task di server",
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
      stopTask,
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
      stopTask,
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
