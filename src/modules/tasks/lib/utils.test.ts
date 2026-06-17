import { describe, expect, it } from "vitest";

import {
  activeGpuUsage,
  averageDurationMs,
  formatDuration,
  latestRun,
  taskProgress,
  taskStatus,
} from "@/modules/tasks/lib/utils";
import type { Task, TaskRun } from "@/modules/tasks/types";

function makeRun(partial: Partial<TaskRun>): TaskRun {
  return {
    status: "Running",
    progress: 0,
    durationMs: 0,
    resourceUsage: { gpu: 0, vram: 0, cpu: 0, memory: 0, tokensProcessed: 0, estimatedCost: 0 },
    ...partial,
  } as TaskRun;
}

function makeTask(runs: TaskRun[]): Task {
  return { id: "t1", runs } as Task;
}

describe("task derivations", () => {
  it("latestRun returns the first run or null for a Draft template", () => {
    const run = makeRun({ progress: 42 });
    expect(latestRun(makeTask([run]))).toBe(run);
    expect(latestRun(makeTask([]))).toBeNull();
  });

  it("taskStatus/taskProgress fall back to Draft/0 when unrun", () => {
    expect(taskStatus(makeTask([]))).toBe("Draft");
    expect(taskProgress(makeTask([]))).toBe(0);
    const t = makeTask([makeRun({ status: "Completed", progress: 100 })]);
    expect(taskStatus(t)).toBe("Completed");
    expect(taskProgress(t)).toBe(100);
  });
});

describe("aggregate metrics", () => {
  it("averageDurationMs averages only completed runs with duration", () => {
    const tasks = [
      makeTask([makeRun({ status: "Completed", durationMs: 1000 })]),
      makeTask([makeRun({ status: "Completed", durationMs: 3000 })]),
      makeTask([makeRun({ status: "Running", durationMs: 9999 })]),
      makeTask([]),
    ];
    expect(averageDurationMs(tasks)).toBe(2000);
    expect(averageDurationMs([makeTask([])])).toBe(0);
  });

  it("activeGpuUsage averages gpu across running/retrying runs only", () => {
    const tasks = [
      makeTask([makeRun({ status: "Running", resourceUsage: { gpu: 60, vram: 0, cpu: 0, memory: 0, tokensProcessed: 0, estimatedCost: 0 } })]),
      makeTask([makeRun({ status: "Retrying", resourceUsage: { gpu: 80, vram: 0, cpu: 0, memory: 0, tokensProcessed: 0, estimatedCost: 0 } })]),
      makeTask([makeRun({ status: "Completed", resourceUsage: { gpu: 0, vram: 0, cpu: 0, memory: 0, tokensProcessed: 0, estimatedCost: 0 } })]),
    ];
    expect(activeGpuUsage(tasks)).toBe(70);
    expect(activeGpuUsage([])).toBe(0);
  });
});

describe("formatDuration", () => {
  it("formats hours, minutes and seconds, with a dash for non-positive", () => {
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(3_660_000)).toBe("1h 1m");
  });
});
