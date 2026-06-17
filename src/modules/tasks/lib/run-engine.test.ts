import { describe, expect, it } from "vitest";

import {
  appendRunLog,
  completeRun,
  runningResourceUsage,
  startNewRun,
  ZERO_RESOURCE,
} from "@/modules/tasks/lib/run-engine";
import type { Task, TaskRun } from "@/modules/tasks/types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    name: "My Model",
    type: "Training",
    gpuRequired: 1,
    hyperparameters: { enableCheckpoint: true, enableEvaluationAfterRun: false },
    runs: [],
    ...overrides,
  } as unknown as Task;
}

describe("ZERO_RESOURCE", () => {
  it("is all zeros", () => {
    expect(ZERO_RESOURCE).toEqual({
      gpu: 0,
      vram: 0,
      cpu: 0,
      memory: 0,
      tokensProcessed: 0,
      estimatedCost: 0,
    });
  });
});

describe("appendRunLog", () => {
  it("appends a timestamped log immutably", () => {
    const run = { logs: [{ time: "00:00:00", message: "start" }] } as TaskRun;
    const next = appendRunLog(run, "second");
    expect(next.logs).toHaveLength(2);
    expect(next.logs[1]?.message).toBe("second");
    expect(run.logs).toHaveLength(1); // original untouched
  });
});

describe("runningResourceUsage", () => {
  it("allocates gpu/vram only when the task needs a GPU", () => {
    const withGpu = runningResourceUsage(makeTask({ gpuRequired: 1 }), ZERO_RESOURCE);
    expect(withGpu.gpu).toBeGreaterThan(0);
    const noGpu = runningResourceUsage(makeTask({ gpuRequired: 0 }), ZERO_RESOURCE);
    expect(noGpu.gpu).toBe(0);
    expect(noGpu.vram).toBe(0);
  });
});

describe("startNewRun", () => {
  it("creates a fresh running run with attempt = runs.length + 1", () => {
    const run = startNewRun(makeTask({ runs: [] }), "Running");
    expect(run.status).toBe("Running");
    expect(run.progress).toBe(0);
    expect(run.attempt).toBe(1);
    expect(run.outputStatus).toBe("Pending");
    expect(run.logs).toHaveLength(1);

    const third = startNewRun(makeTask({ runs: [{}, {}] as TaskRun[] }), "Retrying");
    expect(third.attempt).toBe(3);
    expect(third.status).toBe("Retrying");
  });
});

describe("completeRun", () => {
  it("marks the run completed with progress 100 and output artifacts", () => {
    const task = makeTask();
    const running = startNewRun(task, "Running");
    const done = completeRun(task, running);

    expect(done.status).toBe("Completed");
    expect(done.progress).toBe(100);
    expect(done.outputStatus).toBe("Ready");
    expect(done.durationMs).toBeGreaterThanOrEqual(0);

    const artifactTypes = done.artifacts.map((a) => a.type);
    expect(artifactTypes).toContain("Log file"); // always present
    expect(artifactTypes).toContain("Fine-tuned model"); // task.type === "Training"
    expect(artifactTypes).toContain("Checkpoint file"); // enableCheckpoint
  });
});
