import { describe, expect, it } from "vitest";

import {
  countTasksByStatus,
  deriveExperimentStatus,
  getExperimentTaskStats,
} from "@/modules/experiments/lib/utils";
import type { Experiment } from "@/modules/experiments/types";
import type { Task, TaskRun } from "@/modules/tasks/types";

function exp(overrides: Partial<Experiment> = {}): Experiment {
  return { id: "e1", status: "Active", ...overrides } as Experiment;
}

function task(status: TaskRun["status"] | null, experimentId = "e1"): Task {
  const runs = status ? ([{ status, progress: status === "Completed" ? 100 : 0, durationMs: 0 }] as TaskRun[]) : [];
  return { id: `t-${Math.random()}`, experimentId, runs } as Task;
}

describe("deriveExperimentStatus", () => {
  it("respects an archived experiment regardless of tasks", () => {
    expect(deriveExperimentStatus(exp({ status: "Archived" }), [task("Running")])).toBe("Archived");
  });

  it("is Draft/Active when there are no related tasks", () => {
    expect(deriveExperimentStatus(exp({ status: "Draft" }), [])).toBe("Draft");
    expect(deriveExperimentStatus(exp({ status: "Active" }), [])).toBe("Active");
  });

  it("prioritises Running, all-Completed, then Failed", () => {
    expect(deriveExperimentStatus(exp(), [task("Running"), task("Completed")])).toBe("Running");
    expect(deriveExperimentStatus(exp(), [task("Completed"), task("Completed")])).toBe("Completed");
    // "Failed" only when EVERY run failed/cancelled — nothing succeeded, nothing pending.
    expect(deriveExperimentStatus(exp(), [task("Failed"), task("Failed")])).toBe("Failed");
    // A mix (done+failed), or a failed run alongside a queued one, is still Active.
    expect(deriveExperimentStatus(exp(), [task("Failed"), task("Completed")])).toBe("Active");
    expect(deriveExperimentStatus(exp(), [task("Failed"), task("Queued")])).toBe("Active");
  });

  it("ignores tasks from other experiments", () => {
    expect(deriveExperimentStatus(exp(), [task("Running", "other")])).toBe("Active");
  });
});

describe("getExperimentTaskStats", () => {
  it("counts related tasks by status and averages progress", () => {
    const tasks = [task("Running"), task("Completed"), task("Failed"), task(null)];
    const stats = getExperimentTaskStats(tasks, "e1");
    expect(stats.totalTasks).toBe(4);
    expect(stats.runningTasks).toBe(1);
    expect(stats.completedTasks).toBe(1);
    expect(stats.failedTasks).toBe(1);
    expect(stats.overallProgress).toBe(25); // (0 + 100 + 0 + 0) / 4
  });
});

describe("countTasksByStatus", () => {
  it("returns a full status map for the experiment's tasks", () => {
    const counts = countTasksByStatus([task("Running"), task("Completed")], "e1");
    expect(counts.Running).toBe(1);
    expect(counts.Completed).toBe(1);
    expect(counts.Draft).toBe(0);
  });
});
