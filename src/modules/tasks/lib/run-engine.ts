import { buildDefaultTimeline, formatLogTime, generateRunId } from "@/modules/tasks/lib/utils";
import type { Task, TaskArtifact, TaskResourceUsage, TaskRun } from "@/modules/tasks/types";

/**
 * Pure run-engine helpers for the task-run lifecycle (start → progress →
 * complete) and the mock resource/artifact shapes a run produces. Extracted from
 * the LlmOps provider so the provider stays focused on state + actions; these
 * have no React or state dependencies and are unit-testable in isolation.
 */

export const ZERO_RESOURCE: TaskResourceUsage = {
  gpu: 0,
  vram: 0,
  cpu: 0,
  memory: 0,
  tokensProcessed: 0,
  estimatedCost: 0,
};

export function appendRunLog(run: TaskRun, message: string): TaskRun {
  return { ...run, logs: [...run.logs, { time: formatLogTime(), message }] };
}

export function runningResourceUsage(task: Task, base: TaskResourceUsage): TaskResourceUsage {
  return {
    ...base,
    gpu: task.gpuRequired > 0 ? 45 + Math.floor(Math.random() * 30) : 0,
    vram: task.gpuRequired > 0 ? 35 + Math.floor(Math.random() * 25) : 0,
    cpu: 25 + Math.floor(Math.random() * 20),
    memory: 30 + Math.floor(Math.random() * 25),
  };
}

/** Build the output artifacts a completed run would produce for its task type. */
function buildRunArtifacts(task: Task, runId: string): TaskArtifact[] {
  const artifacts: TaskArtifact[] = [];

  if (task.hyperparameters.enableCheckpoint) {
    artifacts.push({
      id: `${runId}-ckpt`,
      name: `${task.name.split(" ")[0]?.toLowerCase() ?? "model"}-checkpoint.safetensors`,
      type: "Checkpoint file",
      size: "1.2 GB",
    });
  }
  if (task.type === "Fine-tuning" || task.type === "Training") {
    artifacts.push({ id: `${runId}-model`, name: "fine-tuned-adapter", type: "Fine-tuned model", size: "340 MB" });
  }
  if (
    task.hyperparameters.enableEvaluationAfterRun ||
    task.type === "Evaluation" ||
    task.type === "Benchmark"
  ) {
    artifacts.push({ id: `${runId}-eval`, name: "evaluation-report.html", type: "Evaluation report", size: "1.8 MB" });
  }
  if (task.type === "Generation" || task.type === "Dataset Processing") {
    artifacts.push({ id: `${runId}-ds`, name: "generated-dataset.jsonl", type: "Generated dataset", size: "24 MB" });
  }
  if (task.type === "Export") {
    artifacts.push({ id: `${runId}-export`, name: "model-export.gguf", type: "Exported model", size: "4.1 GB" });
  }
  if (task.type === "RAG Indexing") {
    artifacts.push({ id: `${runId}-index`, name: "vector-index.chroma", type: "Vector index", size: "48 MB" });
  }
  if (task.type === "RAG QA Generation") {
    artifacts.push({ id: `${runId}-qa`, name: "rag-qa-dataset.jsonl", type: "RAG QA dataset", size: "320 KB" });
  }
  if (task.type === "Embedding Fine-tuning") {
    artifacts.push({ id: `${runId}-emb`, name: "fine-tuned-embedding.safetensors", type: "Fine-tuned embedding", size: "420 MB" });
  }
  if (task.type === "RAG Evaluation") {
    artifacts.push(
      { id: `${runId}-eval`, name: "rag-evaluation-report.html", type: "RAG evaluation report", size: "2.4 MB" },
      { id: `${runId}-metrics`, name: "rag-metrics.json", type: "RAG metrics", size: "12 KB" }
    );
  }
  artifacts.push({ id: `${runId}-log`, name: "run.log", type: "Log file", size: "128 KB" });

  return artifacts;
}

/** Transition a still-running run to Completed with its output artifacts. */
export function completeRun(task: Task, run: TaskRun): TaskRun {
  const finishedAt = new Date().toISOString();
  const started = run.startedAt ? new Date(run.startedAt).getTime() : Date.now();

  return appendRunLog(
    {
      ...run,
      status: "Completed",
      progress: 100,
      finishedAt,
      durationMs: Date.now() - started,
      outputStatus: "Ready",
      artifacts: buildRunArtifacts(task, run.id),
      resourceUsage: { ...run.resourceUsage, gpu: 0, vram: 0 },
      timeline: run.timeline.map((step) => {
        if (step.id === "running" || step.id === "checkpoint" || step.id === "evaluation") {
          return { ...step, status: "completed" as const };
        }
        if (step.id === "completed") {
          return { ...step, status: "completed" as const, label: "Completed" };
        }
        return step;
      }),
    },
    "Run completed successfully"
  );
}

/** A brand-new run for a task (used by Start when fresh, Retry, and Run again). */
export function startNewRun(task: Task, status: "Running" | "Retrying"): TaskRun {
  const attempt = task.runs.length + 1;
  const startedAt = new Date().toISOString();
  return {
    id: generateRunId(),
    taskId: task.id,
    attempt,
    status,
    progress: 0,
    createdAt: startedAt,
    startedAt,
    durationMs: 0,
    outputStatus: "Pending",
    logs: [
      {
        time: formatLogTime(),
        message: status === "Retrying" ? `Run #${attempt} — retry scheduled` : `Run #${attempt} started`,
      },
    ],
    artifacts: [],
    resourceUsage: runningResourceUsage(task, ZERO_RESOURCE),
    timeline: buildDefaultTimeline().map((s) => {
      if (s.id === "created" || s.id === "queued") return { ...s, status: "completed" as const };
      if (s.id === "started" || s.id === "running") return { ...s, status: "active" as const };
      return s;
    }),
  };
}
