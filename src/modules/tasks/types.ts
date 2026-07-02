export const TASK_TYPES = [
  "Training",
  "Fine-tuning",
  "Evaluation",
  "Inference",
  "Generation",
  "Export",
  "Dataset Processing",
  "Benchmark",
  "RAG Indexing",
  "RAG QA Generation",
  "Embedding Fine-tuning",
  "RAG Evaluation",
] as const;

// Status of a single run/job (an execution). "Draft" is NOT here — it belongs
// to a Task template that has never been run.
export const RUN_STATUSES = [
  "Queued",
  "Running",
  "Paused",
  "Completed",
  "Failed",
  "Cancelled",
  "Retrying",
] as const;

// Derived status shown for a Task = latest run's status, or "Draft" if it has
// no runs yet. Keep "Draft" first so it covers the never-run template case.
export const TASK_STATUSES = [
  "Draft",
  "Queued",
  "Running",
  "Paused",
  "Completed",
  "Failed",
  "Cancelled",
  "Retrying",
] as const;

export const COMPUTE_TARGETS = [
  "Local CPU",
  "Local GPU",
  "Remote GPU",
  "GPU Cluster",
] as const;

export const ENGINE_PLUGINS = [
  "Unsloth",
  "TRL",
  "Axolotl",
  "vLLM",
  "Ollama",
  "llama.cpp",
  "Custom PyTorch",
  "Evaluation Runner",
  "Dataset Processor",
  "RAG Indexer",
  "RAG QA Generator",
  "Embedding Trainer",
  "RAG Evaluator",
] as const;

export const TASK_PRIORITIES = ["Low", "Medium", "High"] as const;

export const OUTPUT_STATUSES = ["None", "Pending", "Ready", "Failed"] as const;

export type TaskType = (typeof TASK_TYPES)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type ComputeTarget = (typeof COMPUTE_TARGETS)[number];
export type EnginePlugin = (typeof ENGINE_PLUGINS)[number];
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export type OutputStatus = (typeof OUTPUT_STATUSES)[number];

export type SortOption = "newest" | "oldest" | "progress" | "duration";

export type TaskHyperparameters = {
  epochs: number;
  batchSize: number;
  learningRate: number;
  maxToken: number;
  temperature: number;
  enableCheckpoint: boolean;
  enableEvaluationAfterRun: boolean;
};

export type TaskArtifact = {
  id: string;
  name: string;
  type: string;
  size: string;
};

export type TaskLogEntry = {
  time: string;
  message: string;
};

export type TaskResourceUsage = {
  gpu: number;
  vram: number;
  cpu: number;
  memory: number;
  tokensProcessed: number;
  estimatedCost: number;
};

export type TimelineStepStatus = "pending" | "active" | "completed" | "failed" | "skipped";

export type TaskTimelineStep = {
  id: string;
  label: string;
  status: TimelineStepStatus;
  timestamp?: string;
};

export type { Experiment } from "@/modules/experiments/types";

/**
 * A Run is one execution of a Task — the equivalent of a Transformer Lab "job"
 * (`/experiment/{id}/jobs`). All live/execution state lives here, never on the
 * Task template.
 */
export type TaskRun = {
  id: string;
  taskId: string;
  /** 1-based execution number (run #1, #2, …) for this task. */
  attempt: number;
  status: RunStatus;
  progress: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs: number;
  outputStatus: OutputStatus;
  logs: TaskLogEntry[];
  artifacts: TaskArtifact[];
  resourceUsage: TaskResourceUsage;
  timeline: TaskTimelineStep[];
};

/**
 * A Task is a reusable template/recipe — the equivalent of a Transformer Lab
 * "task" (`/experiment/{id}/task`). It holds configuration only; running it
 * produces one or more {@link TaskRun}s in `runs` (most recent first).
 */
export type Task = {
  id: string;
  name: string;
  type: TaskType;
  experimentId: string;
  experimentName: string;
  computeTarget: ComputeTarget;
  engine: EnginePlugin;
  createdAt: string;
  description: string;
  owner: string;
  priority: TaskPriority;
  baseModel: string;
  dataset: string;
  gpuRequired: number;
  runtime: string;
  hyperparameters: TaskHyperparameters;
  /** Real LoRA config for TL-derived fine-tune tasks (undefined for mock tasks). */
  loraR?: number;
  loraAlpha?: number;
  /** Execution history, newest first. Empty = template never run (Draft). */
  runs: TaskRun[];
};

/**
 * Backwards-compatible alias. `AITask` now refers to the Task template; files
 * that only use it as a prop type keep working. Read execution state via
 * `latestRun(task)` / `taskStatus(task)` from `lib/utils`.
 */
export type AITask = Task;

export type CreateTaskInput = {
  name: string;
  experimentId: string;
  type: TaskType;
  description: string;
  baseModel: string;
  dataset: string;
  engine: EnginePlugin;
  computeTarget: ComputeTarget;
  gpuRequired: number;
  priority: TaskPriority;
  hyperparameters: TaskHyperparameters;
};

export type TaskFilters = {
  search: string;
  experiment: string | "all";
  type: TaskType | "all";
  status: TaskStatus | "all";
  computeTarget: ComputeTarget | "all";
  sort: SortOption;
};
