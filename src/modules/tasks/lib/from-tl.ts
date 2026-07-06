import { FINETUNE_EXPERIMENT as EXPERIMENT_ID } from "@/lib/tl-constants";
import type {
  ComputeTarget,
  EnginePlugin,
  OutputStatus,
  RunStatus,
  Task,
  TaskArtifact,
  TaskType,
} from "@/modules/tasks/types";

/**
 * Map a real Transformer Lab job (from `/api/tasks/list`) into our `Task` shape
 * (a Task template with one execution Run).
 *
 * REAL fields from TL job_data: id, type/subtype, status, progress, model,
 * dataset, hyperparameters (epochs/batch/lr/max_steps/lora), timing, eval score,
 * owner. Resource usage (GPU/VRAM/cost) isn't exposed per-job so it stays zeroed
 * (the monitor reports real status/progress, not fabricated telemetry). Logs are
 * loaded lazily in the drawer (`/api/tasks/{id}/output`).
 */

type TlJobRow = {
  id: string;
  experimentId: string;
  type: string;
  status: string;
  progress: number;
  model: string;
  template: string;
  startTime: string;
  endTime: string;
  score: number | null;
  subtype: string;
  run: string;
  dataset: string;
  epochs: number;
  batchSize: number;
  learningRate: number;
  maxSteps: number;
  loraR: number;
  loraAlpha: number;
  owner: string;
  models: string[];
  artifacts: string[];
  checkpoint: string;
};

const basename = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p;

/** Categorise a TL output path for the artifact card's subtitle. */
function artifactType(path: string): string {
  if (/\.json$/i.test(path)) return "Config / summary (JSON)";
  if (/\.txt$/i.test(path)) return "Summary (text)";
  if (/checkpoint/i.test(path)) return "Checkpoint";
  return "Trained model / adapter";
}

/** Real output files TL recorded for a finished job → artifact cards. */
function buildArtifacts(row: TlJobRow): TaskArtifact[] {
  const paths = [...row.models, ...row.artifacts];
  if (row.checkpoint) paths.push(row.checkpoint);
  return paths.map((p, i) => ({
    id: `art-${row.id}-${i}`,
    name: basename(p),
    type: artifactType(p),
    size: "",
  }));
}

/** Prefer the real subtype (TRAIN/EVAL/…); top-level type is usually "REMOTE". */
function mapType(subtype: string, type: string): TaskType {
  switch ((subtype || type).toUpperCase()) {
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

/** Real engine: detect Unsloth from the trainer command, else fall back by kind. */
function mapEngine(subtype: string, type: string, run: string): EnginePlugin {
  if (/unsloth/i.test(run)) return "Unsloth";
  switch ((subtype || type).toUpperCase()) {
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

export function tlJobToTask(row: TlJobRow, now: string): Task {
  const type = mapType(row.subtype, row.type);
  const engine = mapEngine(row.subtype, row.type, row.run);
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
    artifacts: buildArtifacts(row),
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
    experimentId: row.experimentId || EXPERIMENT_ID,
    experimentName: row.experimentId || EXPERIMENT_ID,
    computeTarget,
    engine,
    createdAt: created,
    description:
      row.score != null
        ? `${type} · accuracy ${(row.score * 100).toFixed(1)}%`
        : `${type} job on ${row.model}`,
    owner: row.owner || "—",
    // TL has no per-job "priority"; kept as a valid default but not shown as real.
    priority: "Medium",
    baseModel: row.model,
    dataset: row.dataset || "—",
    gpuRequired: 1,
    runtime: engine,
    hyperparameters: {
      epochs: row.epochs,
      batchSize: row.batchSize,
      learningRate: row.learningRate,
      // Training jobs cap by steps, not token budget — surface the real max_steps.
      maxToken: row.maxSteps,
      // TL doesn't expose these per-job for our trainers; keep honest zeros/off.
      temperature: 0,
      enableCheckpoint: false,
      enableEvaluationAfterRun: false,
    },
    // Real LoRA config, shown as its own line in the drawer.
    loraR: row.loraR,
    loraAlpha: row.loraAlpha,
    runs: [run],
  };
}
