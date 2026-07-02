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

/** Jakarta (WIB, UTC+7) — Transformer Lab stores naive UTC timestamps. */
const APP_TIME_ZONE = "Asia/Jakarta";

/**
 * Format a timestamp for display in Jakarta time. Transformer Lab returns naive
 * datetimes ("2026-07-02 04:34:53") that are actually UTC but carry no zone, so
 * we tag them as UTC before converting — otherwise the browser/server parses them
 * as local time and the clock is off by the local offset.
 */
export function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(normalizeToUtc(iso));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
  });
}

/** Tag a zone-less "YYYY-MM-DD HH:MM:SS" string as UTC; pass through ISO strings. */
function normalizeToUtc(s: string): string {
  const naive = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/;
  if (naive.test(s)) return `${s.replace(" ", "T")}Z`;
  return s;
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
