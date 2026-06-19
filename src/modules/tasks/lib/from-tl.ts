import type {
  ComputeTarget,
  EnginePlugin,
  OutputStatus,
  RunStatus,
  Task,
  TaskType,
} from "@/modules/tasks/types";

/**
 * Map a real Transformer Lab job (from `/api/tasks/list`) into our `Task` shape
 * (a Task template with one execution Run).
 *
 * REAL fields from TL: id, type, status, progress, model, timing, eval score.
 * Resource usage (GPU/VRAM/cost) and hyperparameters aren't exposed per-job, so
 * those stay zeroed defaults — the monitor reports real status/progress, not
 * fabricated telemetry. Logs are loaded lazily in the drawer (`/api/tasks/{id}/output`).
 */

type TlJobRow = {
  id: string;
  type: string;
  status: string;
  progress: number;
  model: string;
  template: string;
  startTime: string;
  endTime: string;
  score: number | null;
};

function mapType(t: string): TaskType {
  switch (t.toUpperCase()) {
    case "TRAIN":
      return "Fine-tuning";
    case "EVAL":
      return "Evaluation";
    case "EXPORT":
      return "Export";
    case "GENERATE":
      return "Generation";
    default:
      return "Training";
  }
}

function mapEngine(t: string): EnginePlugin {
  switch (t.toUpperCase()) {
    case "EVAL":
      return "Evaluation Runner";
    case "EXPORT":
      return "llama.cpp";
    case "TRAIN":
      return "Unsloth";
    default:
      return "Custom PyTorch";
  }
}

function mapStatus(s: string): RunStatus {
  switch (s.toUpperCase()) {
    case "COMPLETE":
    case "COMPLETED":
      return "Completed";
    case "RUNNING":
    case "STARTED":
      return "Running";
    case "QUEUED":
    case "NOT_STARTED":
      return "Queued";
    case "FAILED":
      return "Failed";
    case "STOPPED":
    case "CANCELLED":
      return "Cancelled";
    default:
      return "Queued";
  }
}

function outputFor(status: RunStatus): OutputStatus {
  if (status === "Completed") return "Ready";
  if (status === "Failed") return "Failed";
  if (status === "Running" || status === "Queued") return "Pending";
  return "None";
}

function durationMs(start: string, end: string): number {
  const s = Date.parse(start);
  const e = Date.parse(end);
  return Number.isFinite(s) && Number.isFinite(e) && e > s ? e - s : 0;
}

const EXPERIMENT_ID = "nqr-ft";

export function tlJobToTask(row: TlJobRow, now: string): Task {
  const type = mapType(row.type);
  const status = mapStatus(row.status);
  const created = row.startTime || now;
  const run = {
    id: `run-${row.id}`,
    taskId: row.id,
    attempt: 1,
    status,
    progress: row.progress,
    createdAt: created,
    startedAt: row.startTime || undefined,
    finishedAt: row.endTime || undefined,
    durationMs: durationMs(row.startTime, row.endTime),
    outputStatus: outputFor(status),
    logs: [],
    artifacts: [],
    resourceUsage: {
      gpu: 0,
      vram: 0,
      cpu: 0,
      memory: 0,
      tokensProcessed: 0,
      estimatedCost: 0,
    },
    timeline: [
      { id: `tl-${row.id}-start`, label: "Queued", status: "completed" as const },
      {
        id: `tl-${row.id}-run`,
        label: "Running",
        status:
          status === "Completed" || status === "Failed"
            ? ("completed" as const)
            : status === "Running"
              ? ("active" as const)
              : ("pending" as const),
      },
      {
        id: `tl-${row.id}-done`,
        label: row.score != null ? `Score ${(row.score * 100).toFixed(1)}%` : "Done",
        status:
          status === "Completed"
            ? ("completed" as const)
            : status === "Failed"
              ? ("failed" as const)
              : ("pending" as const),
      },
    ],
  };

  const computeTarget: ComputeTarget = "Local GPU";
  return {
    id: row.id,
    name: row.template,
    type,
    experimentId: EXPERIMENT_ID,
    experimentName: EXPERIMENT_ID,
    computeTarget,
    engine: mapEngine(row.type),
    createdAt: created,
    description:
      row.score != null
        ? `${type} · accuracy ${(row.score * 100).toFixed(1)}%`
        : `${type} job on ${row.model}`,
    owner: "AI Team",
    priority: "Medium",
    baseModel: row.model,
    dataset: "—",
    gpuRequired: 1,
    runtime: mapEngine(row.type),
    hyperparameters: {
      epochs: 0,
      batchSize: 0,
      learningRate: 0,
      maxToken: 0,
      temperature: 0,
      enableCheckpoint: false,
      enableEvaluationAfterRun: false,
    },
    runs: [run],
  };
}
