import type { Task, TaskStatus } from "@/modules/tasks/types";
import { latestRun, taskProgress, taskStatus } from "@/modules/tasks/lib/utils";

import type { Experiment, ExperimentStatus, ExperimentTaskStats } from "../types";

export function generateExperimentId(): string {
  return `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function generateActivityId(): string {
  return `act-${Date.now().toString(36)}`;
}

export function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}

export function getTasksForExperiment(tasks: Task[], experimentId: string): Task[] {
  return tasks.filter((t) => t.experimentId === experimentId);
}

export function getExperimentTaskStats(tasks: Task[], experimentId: string): ExperimentTaskStats {
  const related = getTasksForExperiment(tasks, experimentId);
  const totalTasks = related.length;
  const runningTasks = related.filter((t) => {
    const s = taskStatus(t);
    return s === "Running" || s === "Retrying";
  }).length;
  const queuedTasks = related.filter((t) => taskStatus(t) === "Queued").length;
  const completedTasks = related.filter((t) => taskStatus(t) === "Completed").length;
  const failedTasks = related.filter((t) => taskStatus(t) === "Failed").length;
  const overallProgress =
    totalTasks > 0
      ? Math.round(related.reduce((sum, t) => sum + taskProgress(t), 0) / totalTasks)
      : 0;
  const completedWithDuration = related
    .map(latestRun)
    .filter((r) => r != null && r.durationMs > 0);
  const averageDurationMs =
    completedWithDuration.length > 0
      ? Math.round(
          completedWithDuration.reduce((sum, r) => sum + (r?.durationMs ?? 0), 0) /
            completedWithDuration.length
        )
      : 0;

  return {
    totalTasks,
    runningTasks,
    queuedTasks,
    completedTasks,
    failedTasks,
    overallProgress,
    averageDurationMs,
  };
}

export function deriveExperimentStatus(
  experiment: Experiment,
  tasks: Task[]
): ExperimentStatus {
  if (experiment.status === "Archived") return "Archived";

  const related = getTasksForExperiment(tasks, experiment.id);
  if (related.length === 0) {
    return experiment.status === "Draft" ? "Draft" : "Active";
  }
  const statuses = related.map(taskStatus);
  if (statuses.some((s) => s === "Running" || s === "Retrying")) {
    return "Running";
  }
  if (statuses.some((s) => s === "Failed")) return "Failed";
  if (statuses.every((s) => s === "Completed")) return "Completed";
  return experiment.status === "Draft" ? "Draft" : "Active";
}

export function countTasksByStatus(tasks: Task[], experimentId: string): Record<TaskStatus, number> {
  const related = getTasksForExperiment(tasks, experimentId);
  const counts = {
    Draft: 0,
    Queued: 0,
    Running: 0,
    Paused: 0,
    Completed: 0,
    Failed: 0,
    Cancelled: 0,
    Retrying: 0,
  } satisfies Record<TaskStatus, number>;
  for (const task of related) {
    counts[taskStatus(task)] += 1;
  }
  return counts;
}

export const statusStyles: Record<
  ExperimentStatus,
  { bg: string; text: string; dot: string }
> = {
  Draft: { bg: "bg-surface-2", text: "text-ink-soft", dot: "bg-ink-faint" },
  Active: { bg: "bg-info-soft", text: "text-info", dot: "bg-info-solid" },
  Running: { bg: "bg-warning-soft", text: "text-warning", dot: "bg-warning-solid" },
  Completed: { bg: "bg-success-soft", text: "text-success", dot: "bg-success-solid" },
  Failed: { bg: "bg-danger-soft", text: "text-danger", dot: "bg-danger-solid" },
  Archived: { bg: "bg-surface-2", text: "text-ink-faint-strong", dot: "bg-ink-faint" },
};
