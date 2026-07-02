import { APP_TIME_ZONE, parseTlDate } from "@/lib/tl-datetime";
import type { Task, TaskRun, TaskStatus, TaskTimelineStep, TaskType } from "@/modules/tasks/types";

export function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Format a timestamp for display in the app timezone (UTC-safe for TL times). */
export function formatDateTime(iso: string | undefined): string {
  const d = parseTlDate(iso);
  if (!d) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
  });
}

export function formatLogTime(date = new Date()): string {
  return date.toLocaleTimeString("en-US", { hour12: false });
}

export function generateTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function generateRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** The most recent run of a task, or null if it has never run (Draft template). */
export function latestRun(task: Task): TaskRun | null {
  return task.runs[0] ?? null;
}

/** Derived status of a task = its latest run's status, or "Draft" if unrun. */
export function taskStatus(task: Task): TaskStatus {
  return latestRun(task)?.status ?? "Draft";
}

/** Derived progress of a task = its latest run's progress, or 0 if unrun. */
export function taskProgress(task: Task): number {
  return latestRun(task)?.progress ?? 0;
}

export function averageDurationMs(tasks: Task[]): number {
  const completed = tasks
    .map(latestRun)
    .filter((r): r is TaskRun => !!r && r.status === "Completed" && r.durationMs > 0);
  if (completed.length === 0) return 0;
  return Math.round(completed.reduce((sum, r) => sum + r.durationMs, 0) / completed.length);
}

export function activeGpuUsage(tasks: Task[]): number {
  const running = tasks
    .map(latestRun)
    .filter((r): r is TaskRun => !!r && (r.status === "Running" || r.status === "Retrying"));
  if (running.length === 0) return 0;
  const total = running.reduce((sum, r) => sum + r.resourceUsage.gpu, 0);
  return Math.round(total / running.length);
}

export const statusStyles: Record<
  TaskStatus,
  { bg: string; text: string; dot: string }
> = {
  Draft: { bg: "bg-surface-2", text: "text-ink-soft", dot: "bg-ink-faint" },
  Queued: { bg: "bg-info-soft", text: "text-info", dot: "bg-info-solid" },
  Running: { bg: "bg-warning-soft", text: "text-warning", dot: "bg-warning-solid" },
  Paused: { bg: "bg-purple-soft", text: "text-purple", dot: "bg-purple-solid" },
  Completed: { bg: "bg-success-soft", text: "text-success", dot: "bg-success-solid" },
  Failed: { bg: "bg-danger-soft", text: "text-danger", dot: "bg-danger-solid" },
  Cancelled: { bg: "bg-surface-2", text: "text-ink-faint-strong", dot: "bg-ink-faint" },
  Retrying: { bg: "bg-primary-soft", text: "text-primary-strong", dot: "bg-primary" },
};

export const typeIcons: Record<TaskType, string> = {
  Training: "🧠",
  "Fine-tuning": "⚙️",
  Evaluation: "📊",
  Inference: "⚡",
  Generation: "✨",
  Export: "📦",
  "Dataset Processing": "🗂️",
  Benchmark: "🏁",
  "RAG Indexing": "📑",
  "RAG QA Generation": "❓",
  "Embedding Fine-tuning": "🔍",
  "RAG Evaluation": "🎯",
};

export const defaultHyperparameters = {
  epochs: 3,
  batchSize: 8,
  learningRate: 0.0002,
  maxToken: 4096,
  temperature: 0.7,
  enableCheckpoint: true,
  enableEvaluationAfterRun: true,
};

export function buildDefaultTimeline(): TaskTimelineStep[] {
  return [
    { id: "created", label: "Created", status: "completed" },
    { id: "queued", label: "Queued", status: "pending" },
    { id: "started", label: "Started", status: "pending" },
    { id: "running", label: "Running", status: "pending" },
    { id: "checkpoint", label: "Saving Checkpoint", status: "pending" },
    { id: "evaluation", label: "Evaluation", status: "pending" },
    { id: "completed", label: "Completed", status: "pending" },
  ];
}
