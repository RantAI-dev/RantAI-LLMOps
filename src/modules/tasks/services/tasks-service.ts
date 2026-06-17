import { USE_REAL_API } from "@/lib/api/config";
import { initialMockTasks } from "@/modules/tasks/data/mock-tasks";
import type { Task } from "@/modules/tasks/types";

/**
 * The data seam for tasks. Mock today; real wiring later.
 *
 * NOTE: in Transformer Lab a Task (template) and its Runs (jobs) are scoped per
 * experiment (`/experiment/{id}/task/list`, `/experiment/{id}/jobs/list`).
 * Aggregating every task/run across experiments for the global Tasks page needs
 * experiment-context wiring, so the real path is intentionally a TODO — the seam
 * is here and ready.
 */

/** Sync seed for instant initial render while the real API is off. */
export function seedTasks(): Task[] {
  return initialMockTasks;
}

/** Async load — mock today; real per-experiment job aggregation is a TODO. */
export async function fetchTasks(): Promise<Task[]> {
  if (!USE_REAL_API) return initialMockTasks;
  // TODO: iterate experiments → GET /experiment/{id}/task/list (+ /jobs/list)
  // and map TL task+job into our Task/TaskRun shape.
  return initialMockTasks;
}
