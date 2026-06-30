"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading-state";
import { useTasks } from "@/modules/tasks/hooks/use-tasks";
import { cn } from "@/lib/utils";

import { CreateTaskSheet } from "./create-task-sheet";
import { TaskDetailDrawer } from "./task-detail-drawer";
import { TaskFiltersBar } from "./task-filters";
import { TaskSummaryCards } from "./task-summary-cards";
import { TaskTable } from "./task-table";
import { taskUi } from "@/modules/tasks/constants/task-ui";

export function TasksPage() {
  const {
    tasks,
    experiments,
    filteredTasks,
    filters,
    setFilters,
    resetFilters,
    selectedTask,
    setSelectedTaskId,
    isCreateOpen,
    setIsCreateOpen,
    createTaskPresetExperimentId,
    createTask,
    startTask,
    pauseTask,
    stopTask,
    retryTask,
    cloneTask,
    deleteTask,
    isLoading,
    isError,
    reload,
  } = useTasks();
  const router = useRouter();

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
          onView={setSelectedTaskId}
          onStart={startTask}
          onPause={pauseTask}
          onStop={stopTask}
          onRetry={retryTask}
          onClone={cloneTask}
          onDelete={deleteTask}
          onCreateClick={() => router.push("/finetune")}
        />
      )}

      <CreateTaskSheet
        key={isCreateOpen ? "create-task-open" : "create-task-closed"}
        open={isCreateOpen}
        experiments={experiments}
        defaultExperimentId={createTaskPresetExperimentId}
        onClose={() => setIsCreateOpen(false)}
        onSubmit={createTask}
      />

      <TaskDetailDrawer
        task={selectedTask}
        onClose={() => setSelectedTaskId(null)}
        onStart={startTask}
        onPause={pauseTask}
        onStop={stopTask}
        onRetry={retryTask}
        onClone={cloneTask}
        onDelete={deleteTask}
      />
    </div>
  );
}
