import { initialMockTasks } from "@/modules/tasks/data/mock-tasks";
import { tlJobToTask } from "@/modules/tasks/lib/from-tl";
import type { Task } from "@/modules/tasks/types";

/**
 * The data seam for tasks.
 *
 * `seedTasks()` gives the rich mock for instant first paint. `fetchTasks()`
 * pulls REAL jobs (train / eval / export) from Transformer Lab via our
 * `/api/tasks/list` BFF (server-side permanent key, independent of the app's
 * mock login). Each job becomes a Task with one execution run. Per-job resource
 * telemetry and hyperparameters stay defaults (TL doesn't expose them per job).
 */

/** Sync seed for instant initial render. */
export function seedTasks(): Task[] {
  return initialMockTasks;
}

type TasksResponse = {
  jobs?: Array<{
    id: string;
    type: string;
    status: string;
    progress: number;
    model: string;
    template: string;
    startTime: string;
    endTime: string;
    score: number | null;
  }>;
};

/** Async load — real TL jobs via the tasks BFF. */
export async function fetchTasks(): Promise<Task[]> {
  try {
    const res = await fetch("/api/tasks/list", { cache: "no-store" });
    if (!res.ok) throw new Error(`tasks ${res.status}`);
    const data = (await res.json()) as TasksResponse;
    const now = new Date().toISOString();
    const tasks = (data.jobs ?? []).map((j) => tlJobToTask(j, now));
    return tasks.length > 0 ? tasks : initialMockTasks;
  } catch {
    // BFF unreachable (or non-browser context): degrade to the mock seed.
    return initialMockTasks;
  }
}
