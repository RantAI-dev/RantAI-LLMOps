"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading-state";
import { useTasks } from "@/modules/tasks/hooks/use-tasks";
import { cn } from "@/lib/utils";

import { TaskDetailDrawer } from "./task-detail-drawer";
import { TaskFiltersBar } from "./task-filters";
import { TaskSummaryCards } from "./task-summary-cards";
import { TaskTable } from "./task-table";
import { taskUi } from "@/modules/tasks/constants/task-ui";

export function TasksPage() {
  const {
    tasks,
    filteredTasks,
    filters,
    setFilters,
    resetFilters,
    stopTask,
    deleteTask,
    isLoading,
    isError,
    reload,
  } = useTasks();
  const router = useRouter();

  // The task detail drawer is driven by the URL (`?task=<id>`) so it's
  // deep-linkable and the browser Back button closes it. The URL is the single
  // source of truth — no separate selected-id state to keep in sync.
  const searchParams = useSearchParams();
  const openTaskId = searchParams.get("task");
  const selectedTask = openTaskId ? tasks.find((t) => t.id === openTaskId) ?? null : null;
  const openTask = (id: string) => router.push(`/tasks?task=${encodeURIComponent(id)}`);
  const closeTask = () => router.push("/tasks");

  const showEmpty = tasks.length === 0;
  const showFilteredEmpty = !showEmpty && filteredTasks.length === 0;

  return (
    <div className="min-w-0 w-full space-y-4">
      <div className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className={cn("text-primary", taskUi.title)}>Tasks</h1>
          <p className={cn("mt-1 max-w-2xl", taskUi.subheading)}>
            Manage AI jobs, training runs, evaluations, inference tasks, and model operations.
          </p>
        </div>
        {/* Real jobs are launched from Fine-tune / Evals (compute-provider), not a
            generic create form, so this points there. */}
        <Button type="button" className="shrink-0" nativeButton={false} render={
          <Link href="/finetune">
            <Plus className="size-4" />
            New run
          </Link>
        } />
      </div>

      <TaskSummaryCards tasks={tasks} />

      {!isLoading && !isError ? (
        <TaskFiltersBar
          filters={filters}
          onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
          onReset={resetFilters}
        />
      ) : null}

      {isLoading ? (
        <LoadingState label="Loading tasks…" />
      ) : isError ? (
        <ErrorState onRetry={reload} />
      ) : showFilteredEmpty ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          No tasks match your filters.{" "}
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={resetFilters}
          >
            Reset filters
          </button>
        </div>
      ) : (
        <TaskTable
          tasks={filteredTasks}
          onView={openTask}
          onStop={stopTask}
          onDelete={deleteTask}
          onCreateClick={() => router.push("/finetune")}
        />
      )}

      <TaskDetailDrawer
        task={selectedTask}
        onClose={closeTask}
        onStop={stopTask}
        onDelete={deleteTask}
      />
    </div>
  );
}
