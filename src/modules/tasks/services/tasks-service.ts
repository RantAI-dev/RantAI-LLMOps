import { initialMockTasks } from "@/modules/tasks/data/mock-tasks";
import { tlJobToTask } from "@/modules/tasks/lib/from-tl";
import type { Task } from "@/modules/tasks/types";

/**
 * The data seam for tasks.
 *
 * `seedTasks()` gives the rich mock for instant first paint. `fetchTasks()`
 * pulls REAL jobs (train / eval / export) from Transformer Lab via our
 * `/api/tasks/list` BFF (server-side permanent key, independent of the app's
 * mock login). Each job becomes a Task with one execution run — real dataset +
 * hyperparameters included. Only per-job resource telemetry (GPU/VRAM/cost) stays
 * defaulted (TL doesn't expose that per job).
 */

/** Sync seed for instant initial render. */
export function seedTasks(): Task[] {
  return initialMockTasks;
}

type TasksResponse = {
  jobs?: Array<{
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
  }>;
};

/** Async load — real TL jobs via the tasks BFF. */
export async function fetchTasks(): Promise<Task[]> {
  try {
    const res = await fetch("/api/tasks/list", { cache: "no-store" });
    if (!res.ok) throw new Error(`tasks ${res.status}`);
    const data = (await res.json()) as TasksResponse;
    const now = new Date().toISOString();
    // Return the REAL list even when empty — "the backend has no jobs" is honest
    // data, not a reason to show demo tasks. (Demo mocks would also include a
    // perpetually-"Running" row, which would keep the live poller running
    // forever.) Mocks are only for the instant-paint seed + unreachable BFF.
    return (data.jobs ?? []).map((j) => tlJobToTask(j, now));
  } catch {
    // BFF unreachable (or non-browser context): degrade to the mock seed.
    return initialMockTasks;
  }
}
