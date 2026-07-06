export const EXPERIMENT_STATUSES = [
  "Draft",
  "Active",
  "Running",
  "Completed",
  "Failed",
  "Archived",
] as const;

export const BASE_MODELS = [
  "Llama 3.1 8B",
  "Llama 3.1 70B",
  "Qwen 2.5 14B",
  "Mistral 7B",
  "Gemma 2 9B",
  "GPT-compatible API Model",
] as const;

export const DATASETS = [
  "WMS FAQ Dataset v3",
  "Invoice Validation Dataset v2",
  "Internal Knowledge Eval Set",
  "Customer Support Dataset",
  "Warehouse Operation Dataset",
  "No dataset selected",
] as const;

export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];
export type BaseModel = (typeof BASE_MODELS)[number];
export type ExperimentDataset = (typeof DATASETS)[number];

export type ExperimentActivity = {
  id: string;
  experimentId: string;
  type: string;
  message: string;
  createdAt: string;
};

export type Experiment = {
  id: string;
  name: string;
  description: string;
  objective: string;
  status: ExperimentStatus;
  owner: string;
  baseModel: string;
  dataset: string;
  successMetric: string;
  evaluationThreshold: string;
  bestScore: number;
  tags: string[];
  notes: string;
  createdAt: string;
  updatedAt: string;
  activityHistory: ExperimentActivity[];
};

export type CreateExperimentInput = {
  name: string;
  description: string;
  objective: string;
  owner: string;
  baseModel: string;
  dataset: string;
  successMetric: string;
  evaluationThreshold: string;
  status: ExperimentStatus;
  tags: string[];
  notes: string;
};

export type ExperimentFilters = {
  search: string;
  status: ExperimentStatus | "all";
  baseModel: string | "all";
  dataset: string | "all";
  sort:
    | "newest"
    | "oldest"
    | "updated"
    | "most-tasks"
    | "best-score";
};

export type ExperimentTaskStats = {
  totalTasks: number;
  runningTasks: number;
  queuedTasks: number;
  completedTasks: number;
  failedTasks: number;
  overallProgress: number;
  averageDurationMs: number;
};
