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
import {
  buildDefaultTimeline,
  formatLogTime,
  generateRunId,
  generateTaskId,
  latestRun,
  taskProgress,
  taskStatus,
} from "@/modules/tasks/lib/utils";
import {
  appendRunLog,
  completeRun,
  runningResourceUsage,
  startNewRun,
  ZERO_RESOURCE,
} from "@/modules/tasks/lib/run-engine";
import type {
  CreateTaskInput,
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
  isCreateTaskOpen: boolean;
  createTaskPresetExperimentId: string | null;
  openCreateTask: (experimentId?: string) => void;
  closeCreateTask: () => void;
  createTask: (input: CreateTaskInput) => string | undefined;
  startTask: (id: string) => void;
  pauseTask: (id: string) => void;
  stopTask: (id: string) => void;
  retryTask: (id: string) => void;
  cloneTask: (id: string) => void;
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
    fetchTasks
  );
  const [experiments, setExperiments] = useState<Experiment[]>(seedExperiments);
  const {
    isLoading: experimentsLoading,
    isError: experimentsError,
    reload: reloadExperiments,
  } = useResourceFetch(setExperiments, fetchExperiments);
  const [taskFilters, setTaskFilters] = useState<TaskFilters>(defaultTaskFilters);
  const [experimentFilters, setExperimentFilters] =
    useState<ExperimentFilters>(defaultExperimentFilters);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedExperimentId, setSelectedExperimentId] = useState<string | null>(null);
  const [isCreateTaskOpen, setIsCreateTaskOpen] = useState(false);
  const [createTaskPresetExperimentId, setCreateTaskPresetExperimentId] = useState<
    string | null
  >(null);
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

  const openCreateTask = useCallback((experimentId?: string) => {
    setCreateTaskPresetExperimentId(experimentId ?? null);
    setIsCreateTaskOpen(true);
  }, []);

  const closeCreateTask = useCallback(() => {
    setIsCreateTaskOpen(false);
    setCreateTaskPresetExperimentId(null);
  }, []);

  const createTask = useCallback(
    (input: CreateTaskInput) => {
      const experiment = getExperimentById(input.experimentId);
      if (!experiment) return undefined;

      const id = generateTaskId();
      const createdAt = new Date().toISOString();
      const newTask: Task = {
        id,
        name: input.name,
        type: input.type,
        experimentId: experiment.id,
        experimentName: experiment.name,
        computeTarget: input.computeTarget,
        engine: input.engine,
        createdAt,
        description: input.description,
        owner: "Admin-NQR",
        priority: input.priority,
        baseModel: input.baseModel,
        dataset: input.dataset,
        gpuRequired: input.gpuRequired,
        runtime: "Auto-detected",
        hyperparameters: input.hyperparameters,
        // Creating a task queues its first run (run #1).
        runs: [
          {
            id: generateRunId(),
            taskId: id,
            attempt: 1,
            status: "Queued",
            progress: 0,
            createdAt,
            durationMs: 0,
            outputStatus: "None",
            logs: [
              { time: formatLogTime(), message: "Run #1 created" },
              { time: formatLogTime(), message: "Run #1 queued" },
            ],
            artifacts: [],
            resourceUsage: { ...ZERO_RESOURCE },
            timeline: buildDefaultTimeline().map((s, i) =>
              i <= 1 ? { ...s, status: i === 0 ? "completed" : "active" } : s
            ),
          },
        ],
      };
      setTasks((prev) => [newTask, ...prev]);
      appendExperimentActivity(experiment.id, "task_created", `Task created: ${newTask.name}`);
      closeCreateTask();
      return id;
    },
    [appendExperimentActivity, closeCreateTask, getExperimentById]
  );

  const startTask = useCallback(
    (id: string) => {
      const task = tasks.find((t) => t.id === id);
      if (!task) return;
      const latest = latestRun(task);
      const resumable = latest && (latest.status === "Paused" || latest.status === "Queued");

      setTasks((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t;
          const current = t.runs[0];
          if (current && (current.status === "Paused" || current.status === "Queued")) {
            const resumed = appendRunLog(
              {
                ...current,
                status: "Running",
                startedAt: current.startedAt ?? new Date().toISOString(),
                outputStatus: "Pending",
                resourceUsage: runningResourceUsage(t, current.resourceUsage),
                timeline: current.timeline.map((s) => {
                  if (s.id === "queued") return { ...s, status: "completed" as const };
                  if (s.id === "started" || s.id === "running") return { ...s, status: "active" as const };
                  return s;
                }),
              },
              current.status === "Paused" ? "Run resumed" : "Training started"
            );
            return { ...t, runs: [resumed, ...t.runs.slice(1)] };
          }
          // No active run (fresh template or last run finished) → start a new run.
          return { ...t, runs: [startNewRun(t, "Running"), ...t.runs] };
        })
      );

      appendExperimentActivity(
        task.experimentId,
        "task_started",
        resumable ? `Run resumed: ${task.name}` : `Run started: ${task.name}`
      );
    },
    [appendExperimentActivity, tasks]
  );

  const pauseTask = useCallback(
    (id: string) => {
      updateLatestRun(id, (run) =>
        run.status === "Running" ? appendRunLog({ ...run, status: "Paused" }, "Run paused by user") : run
      );
    },
    [updateLatestRun]
  );

  const stopTask = useCallback(
    (id: string) => {
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
      });
    },
    [updateLatestRun]
  );

  const retryTask = useCallback(
    (id: string) => {
      const task = tasks.find((t) => t.id === id);
      if (!task || latestRun(task)?.status !== "Failed") return;

      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, runs: [startNewRun(t, "Retrying"), ...t.runs] } : t))
      );
      appendExperimentActivity(task.experimentId, "task_started", `Run retried: ${task.name}`);

      window.setTimeout(() => {
        updateLatestRun(id, (run) =>
          run.status === "Retrying"
            ? appendRunLog({ ...run, status: "Running" }, "Retry started — reloading configuration")
            : run
        );
      }, 1500);
    },
    [appendExperimentActivity, tasks, updateLatestRun]
  );

  const cloneTask = useCallback(
    (id: string) => {
      const source = tasks.find((t) => t.id === id);
      if (!source) return;
      // Cloning duplicates the template only — a fresh recipe with no runs.
      const clone: Task = {
        ...source,
        id: generateTaskId(),
        name: `${source.name} (copy)`,
        createdAt: new Date().toISOString(),
        runs: [],
      };
      setTasks((prev) => [clone, ...prev]);
      appendExperimentActivity(source.experimentId, "task_created", `Task cloned: ${clone.name}`);
    },
    [appendExperimentActivity, tasks]
  );

  const deleteTask = useCallback((id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    setSelectedTaskId((current) => (current === id ? null : current));
  }, []);

  const createExperiment = useCallback((input: CreateExperimentInput) => {
    const id = generateExperimentId();
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
    setExperiments((prev) => [experiment, ...prev]);
    setIsCreateExperimentOpen(false);
    return id;
  }, []);

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
    [selectedExperimentId]
  );

  // Simulate live progress for the latest run of every actively-running task.
  useEffect(() => {
    const interval = window.setInterval(() => {
      setTasks((prev) => {
        // Skip the state update entirely when nothing is running — returning the
        // same reference makes React bail out, avoiding a re-render every tick.
        const hasActiveRun = prev.some((t) => {
          const r = t.runs[0];
          return r && (r.status === "Running" || r.status === "Retrying");
        });
        if (!hasActiveRun) return prev;

        return prev.map((task) => {
          const run = task.runs[0];
          if (!run || (run.status !== "Running" && run.status !== "Retrying")) return task;

          const increment = 1 + Math.floor(Math.random() * 3);
          const nextProgress = Math.min(100, run.progress + increment);

          if (nextProgress >= 100) {
            appendExperimentActivity(task.experimentId, "task_completed", `Run completed: ${task.name}`);
            return { ...task, runs: [completeRun(task, { ...run, progress: nextProgress }), ...task.runs.slice(1)] };
          }

          const tokensDelta = Math.floor(8000 + Math.random() * 12000);
          const milestone =
            nextProgress % 20 === 0 && nextProgress > run.progress
              ? appendRunLog(run, `Epoch checkpoint — ${nextProgress}% complete`)
              : run;

          const nextRun: TaskRun = {
            ...milestone,
            progress: nextProgress,
            durationMs: run.startedAt ? Date.now() - new Date(run.startedAt).getTime() : run.durationMs,
            resourceUsage: {
              ...run.resourceUsage,
              gpu: Math.min(98, run.resourceUsage.gpu + (Math.random() > 0.7 ? 2 : -1)),
              vram: Math.min(95, run.resourceUsage.vram + (Math.random() > 0.6 ? 1 : 0)),
              tokensProcessed: run.resourceUsage.tokensProcessed + tokensDelta,
              estimatedCost: Number((run.resourceUsage.estimatedCost + tokensDelta * 0.000002).toFixed(2)),
            },
          };
          return { ...task, runs: [nextRun, ...task.runs.slice(1)] };
        });
      });
    }, 1200);

    return () => window.clearInterval(interval);
  }, [appendExperimentActivity]);

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
      isCreateTaskOpen,
      createTaskPresetExperimentId,
      openCreateTask,
      closeCreateTask,
      createTask,
      startTask,
      pauseTask,
      stopTask,
      retryTask,
      cloneTask,
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
      isCreateTaskOpen,
      createTaskPresetExperimentId,
      openCreateTask,
      closeCreateTask,
      createTask,
      startTask,
      pauseTask,
      stopTask,
      retryTask,
      cloneTask,
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
