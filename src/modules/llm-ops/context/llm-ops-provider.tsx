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
import {
  fetchExperiments,
  saveExperimentNotes,
  seedExperiments,
} from "@/modules/experiments/services/experiments-service";
import {
  deriveExperimentStatus,
  generateActivityId,
  generateExperimentId,
} from "@/modules/experiments/lib/utils";
import type {
  CreateExperimentInput,
  Experiment,
  ExperimentFilters,
} from "@/modules/experiments/types";
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
  experiment: "all",
  type: "all",
  status: "all",
  computeTarget: "all",
  sort: "newest",
};

const defaultExperimentFilters: ExperimentFilters = {
  search: "",
  status: "all",
  baseModel: "all",
  dataset: "all",
  sort: "newest",
};

type LlmOpsContextValue = {
  tasks: Task[];
  experiments: Experiment[];
  getExperimentById: (id: string) => Experiment | undefined;
  taskFilters: TaskFilters;
  setTaskFilters: React.Dispatch<React.SetStateAction<TaskFilters>>;
  resetTaskFilters: () => void;
  filteredTasks: Task[];
  selectedTaskId: string | null;
  setSelectedTaskId: (id: string | null) => void;
  selectedTask: Task | null;
  stopTask: (id: string) => void;
  deleteTask: (id: string) => void;
  experimentFilters: ExperimentFilters;
  setExperimentFilters: React.Dispatch<React.SetStateAction<ExperimentFilters>>;
  resetExperimentFilters: () => void;
  filteredExperiments: Experiment[];
  selectedExperimentId: string | null;
  setSelectedExperimentId: (id: string | null) => void;
  selectedExperiment: Experiment | null;
  isCreateExperimentOpen: boolean;
  setIsCreateExperimentOpen: (open: boolean) => void;
  isEditExperimentOpen: boolean;
  setIsEditExperimentOpen: (open: boolean) => void;
  deleteExperimentTargetId: string | null;
  setDeleteExperimentTargetId: (id: string | null) => void;
  createExperiment: (input: CreateExperimentInput) => string;
  updateExperiment: (id: string, input: Partial<CreateExperimentInput>) => void;
  updateExperimentNotes: (id: string, notes: string) => void;
  cloneExperiment: (id: string) => void;
  archiveExperiment: (id: string) => void;
  deleteExperiment: (id: string) => void;
  changeExperimentStatus: (id: string, status: Experiment["status"]) => void;
  appendExperimentActivity: (experimentId: string, type: string, message: string) => void;
  tasksLoading: boolean;
  tasksError: boolean;
  reloadTasks: () => void;
  experimentsLoading: boolean;
  experimentsError: boolean;
  reloadExperiments: () => void;
};

const LlmOpsContext = createContext<LlmOpsContextValue | null>(null);

export function LlmOpsProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>(seedTasks);
  const { isLoading: tasksLoading, isError: tasksError, reload: reloadTasks } = useResourceFetch(
    setTasks,
    fetchTasks,
    { always: true }
  );
  const [experiments, setExperiments] = useState<Experiment[]>(seedExperiments);
  const {
    isLoading: experimentsLoading,
    isError: experimentsError,
    reload: reloadExperiments,
  } = useResourceFetch(setExperiments, fetchExperiments, { always: true });
  const [taskFilters, setTaskFilters] = useState<TaskFilters>(defaultTaskFilters);
  const [experimentFilters, setExperimentFilters] =
    useState<ExperimentFilters>(defaultExperimentFilters);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedExperimentId, setSelectedExperimentId] = useState<string | null>(null);
  const [isCreateExperimentOpen, setIsCreateExperimentOpen] = useState(false);
  const [isEditExperimentOpen, setIsEditExperimentOpen] = useState(false);
  const [deleteExperimentTargetId, setDeleteExperimentTargetId] = useState<string | null>(
    null
  );

  const getExperimentById = useCallback(
    (id: string) => experiments.find((e) => e.id === id),
    [experiments]
  );

  const appendExperimentActivity = useCallback(
    (experimentId: string, type: string, message: string) => {
      const createdAt = new Date().toISOString();
      setExperiments((prev) =>
        prev.map((exp) =>
          exp.id === experimentId
            ? {
                ...exp,
                updatedAt: createdAt,
                activityHistory: [
                  {
                    id: generateActivityId(),
                    experimentId,
                    type,
                    message,
                    createdAt,
                  },
                  ...exp.activityHistory,
                ],
              }
            : exp
        )
      );
    },
    []
  );

  const filteredTasks = useMemo(() => {
    let result = [...tasks];
    const q = taskFilters.search.trim().toLowerCase();

    if (q) {
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.experimentName.toLowerCase().includes(q)
      );
    }
    if (taskFilters.experiment !== "all") {
      result = result.filter((t) => t.experimentId === taskFilters.experiment);
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

  const filteredExperiments = useMemo(() => {
    let result = [...experiments];
    const q = experimentFilters.search.trim().toLowerCase();

    if (q) {
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) || e.owner.toLowerCase().includes(q)
      );
    }
    if (experimentFilters.status !== "all") {
      result = result.filter(
        (e) => deriveExperimentStatus(e, tasks) === experimentFilters.status
      );
    }
    if (experimentFilters.baseModel !== "all") {
      result = result.filter((e) => e.baseModel === experimentFilters.baseModel);
    }
    if (experimentFilters.dataset !== "all") {
      result = result.filter((e) => e.dataset === experimentFilters.dataset);
    }

    const taskCount = (id: string) => tasks.filter((t) => t.experimentId === id).length;

    result.sort((a, b) => {
      switch (experimentFilters.sort) {
        case "oldest":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "updated":
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        case "most-tasks":
          return taskCount(b.id) - taskCount(a.id);
        case "best-score":
          return b.bestScore - a.bestScore;
        case "newest":
        default:
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });

    return result;
  }, [experiments, experimentFilters, tasks]);

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId]
  );

  const selectedExperiment = useMemo(
    () => experiments.find((e) => e.id === selectedExperimentId) ?? null,
    [experiments, selectedExperimentId]
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

  const createExperiment = useCallback((input: CreateExperimentInput) => {
    // TL uses the (secured) experiment name as its id. We optimistically add it,
    // then create it for real and reload the authoritative list.
    const id = input.name;
    const now = new Date().toISOString();
    const experiment: Experiment = {
      id,
      name: input.name,
      description: input.description,
      objective: input.objective,
      status: input.status === "Archived" ? "Draft" : input.status,
      owner: input.owner,
      baseModel: input.baseModel,
      dataset: input.dataset,
      successMetric: input.successMetric,
      evaluationThreshold: input.evaluationThreshold,
      bestScore: 0,
      tags: input.tags,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
      activityHistory: [
        {
          id: generateActivityId(),
          experimentId: id,
          type: "created",
          message: "Experiment created",
          createdAt: now,
        },
      ],
    };
    void runOptimistic({
      apply: () => {
        setExperiments((prev) => [experiment, ...prev]);
        setIsCreateExperimentOpen(false);
      },
      request: () =>
        fetch("/api/experiments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: input.name }),
        }),
      // On failure the optimistic row never existed in TL — reload drops it.
      rollback: () => reloadExperiments(),
      errorMessage: "Gagal membuat experiment di server",
      // On success, reconcile against TL's authoritative id (it slugs the name).
    }).then((ok) => {
      if (ok) reloadExperiments();
    });
    return id;
  }, [reloadExperiments]);

  const updateExperiment = useCallback(
    (id: string, input: Partial<CreateExperimentInput>) => {
      const now = new Date().toISOString();
      setExperiments((prev) =>
        prev.map((exp) =>
          exp.id === id
            ? {
                ...exp,
                ...input,
                updatedAt: now,
                activityHistory: [
                  {
                    id: generateActivityId(),
                    experimentId: id,
                    type: "updated",
                    message: "Experiment updated",
                    createdAt: now,
                  },
                  ...exp.activityHistory,
                ],
              }
            : exp
        )
      );
      setIsEditExperimentOpen(false);
    },
    []
  );

  const updateExperimentNotes = useCallback((id: string, notes: string) => {
    const now = new Date().toISOString();
    setExperiments((prev) =>
      prev.map((exp) =>
        exp.id === id
          ? {
              ...exp,
              notes,
              updatedAt: now,
              activityHistory: [
                {
                  id: generateActivityId(),
                  experimentId: id,
                  type: "updated",
                  message: "Notes updated",
                  createdAt: now,
                },
                ...exp.activityHistory,
              ],
            }
          : exp
      )
    );
    // Mirror to the data seam: no-op in mock, POST /experiment/{id}/notes when real.
    void saveExperimentNotes(id, notes);
  }, []);

  const changeExperimentStatus = useCallback(
    (id: string, status: Experiment["status"]) => {
      const now = new Date().toISOString();
      setExperiments((prev) =>
        prev.map((exp) =>
          exp.id === id
            ? {
                ...exp,
                status,
                updatedAt: now,
                activityHistory: [
                  {
                    id: generateActivityId(),
                    experimentId: id,
                    type: "status_changed",
                    message: `Status changed to ${status}`,
                    createdAt: now,
                  },
                  ...exp.activityHistory,
                ],
              }
            : exp
        )
      );
    },
    []
  );

  const cloneExperiment = useCallback((id: string) => {
    const source = experiments.find((e) => e.id === id);
    if (!source) return;
    const newId = generateExperimentId();
    const now = new Date().toISOString();
    const clone: Experiment = {
      ...source,
      id: newId,
      name: `${source.name} (copy)`,
      status: "Draft",
      bestScore: 0,
      createdAt: now,
      updatedAt: now,
      activityHistory: [
        {
          id: generateActivityId(),
          experimentId: newId,
          type: "created",
          message: "Experiment cloned",
          createdAt: now,
        },
      ],
    };
    setExperiments((prev) => [clone, ...prev]);
  }, [experiments]);

  const archiveExperiment = useCallback((id: string) => {
    changeExperimentStatus(id, "Archived");
  }, [changeExperimentStatus]);

  const deleteExperiment = useCallback(
    (id: string) => {
      // Optimistically drop it + unlink its tasks; on failure re-sync + toast.
      void runOptimistic({
        apply: () => {
          setExperiments((prev) => prev.filter((e) => e.id !== id));
          setTasks((prev) =>
            prev.map((t) =>
              t.experimentId === id
                ? {
                    ...t,
                    experimentId: "unlinked",
                    experimentName: "Unlinked experiment",
                  }
                : t
            )
          );
          setDeleteExperimentTargetId(null);
          if (selectedExperimentId === id) setSelectedExperimentId(null);
        },
        request: () => fetch(`/api/experiments/${encodeURIComponent(id)}`, { method: "DELETE" }),
        rollback: () => {
          reloadExperiments();
          reloadTasks();
        },
        errorMessage: "Gagal menghapus experiment di server",
      });
    },
    [selectedExperimentId, reloadExperiments, reloadTasks]
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
  const resetExperimentFilters = useCallback(
    () => setExperimentFilters(defaultExperimentFilters),
    []
  );

  const value = useMemo<LlmOpsContextValue>(
    () => ({
      tasks,
      experiments,
      getExperimentById,
      taskFilters,
      setTaskFilters,
      resetTaskFilters,
      filteredTasks,
      selectedTaskId,
      setSelectedTaskId,
      selectedTask,
      stopTask,
      deleteTask,
      experimentFilters,
      setExperimentFilters,
      resetExperimentFilters,
      filteredExperiments,
      selectedExperimentId,
      setSelectedExperimentId,
      selectedExperiment,
      isCreateExperimentOpen,
      setIsCreateExperimentOpen,
      isEditExperimentOpen,
      setIsEditExperimentOpen,
      deleteExperimentTargetId,
      setDeleteExperimentTargetId,
      createExperiment,
      updateExperiment,
      updateExperimentNotes,
      cloneExperiment,
      archiveExperiment,
      deleteExperiment,
      changeExperimentStatus,
      appendExperimentActivity,
      tasksLoading,
      tasksError,
      reloadTasks,
      experimentsLoading,
      experimentsError,
      reloadExperiments,
    }),
    [
      tasks,
      experiments,
      getExperimentById,
      taskFilters,
      resetTaskFilters,
      filteredTasks,
      selectedTaskId,
      selectedTask,
      stopTask,
      deleteTask,
      experimentFilters,
      resetExperimentFilters,
      filteredExperiments,
      selectedExperimentId,
      selectedExperiment,
      isCreateExperimentOpen,
      isEditExperimentOpen,
      deleteExperimentTargetId,
      createExperiment,
      updateExperiment,
      updateExperimentNotes,
      cloneExperiment,
      archiveExperiment,
      deleteExperiment,
      changeExperimentStatus,
      appendExperimentActivity,
      tasksLoading,
      tasksError,
      reloadTasks,
      experimentsLoading,
      experimentsError,
      reloadExperiments,
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
