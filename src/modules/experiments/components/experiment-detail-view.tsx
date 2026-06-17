"use client";

import Link from "next/link";
import { NotebookPen, Plus } from "lucide-react";
import { useState } from "react";

import { BreadcrumbNav } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ExperimentActivityModal } from "@/modules/experiments/components/experiment-activity-modal";
import { ExperimentDetailToolbar } from "@/modules/experiments/components/experiment-detail-toolbar";
import { ExperimentStatusBadge } from "@/modules/experiments/components/experiment-status-badge";
import {
  countTasksByStatus,
  deriveExperimentStatus,
  formatDateTime,
  formatDuration,
  getExperimentTaskStats,
  getTasksForExperiment,
} from "@/modules/experiments/lib/utils";
import type { Experiment } from "@/modules/experiments/types";
import { CreateTaskSheet } from "@/modules/tasks/components/create-task-sheet";
import { TaskDetailDrawer } from "@/modules/tasks/components/task-detail-drawer";
import { TaskTable } from "@/modules/tasks/components/task-table";
import { useLlmOps } from "@/modules/llm-ops/context/llm-ops-provider";
import type { AITask, CreateTaskInput } from "@/modules/tasks/types";
import { cn } from "@/lib/utils";

const TASK_STATUS_ORDER = [
  "Draft",
  "Queued",
  "Running",
  "Paused",
  "Completed",
  "Failed",
  "Cancelled",
  "Retrying",
] as const;

const statusBarColors: Record<string, string> = {
  Draft: "bg-ink-faint",
  Queued: "bg-info-light",
  Running: "bg-warning-solid",
  Paused: "bg-purple-light",
  Completed: "bg-success-solid",
  Failed: "bg-danger-solid",
  Cancelled: "bg-ink-faint-strong",
  Retrying: "bg-[#fb923c]",
};

type ExperimentDetailViewProps = {
  experiment: Experiment;
  tasks: AITask[];
  onBack: () => void;
  onEdit: () => void;
  onClone: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onChangeStatus: (status: Experiment["status"]) => void;
};

export function ExperimentDetailView({
  experiment,
  tasks,
  onBack,
  onEdit,
  onClone,
  onArchive,
  onDelete,
  onChangeStatus,
}: ExperimentDetailViewProps) {
  const {
    experiments,
    isCreateTaskOpen,
    closeCreateTask,
    createTaskPresetExperimentId,
    openCreateTask,
    createTask,
    selectedTask,
    setSelectedTaskId,
    startTask,
    pauseTask,
    stopTask,
    retryTask,
    cloneTask,
    deleteTask,
  } = useLlmOps();

  const relatedTasks = getTasksForExperiment(tasks, experiment.id);
  const stats = getExperimentTaskStats(tasks, experiment.id);
  const effectiveStatus = deriveExperimentStatus(experiment, tasks);
  const statusCounts = countTasksByStatus(tasks, experiment.id);
  const totalForBar = relatedTasks.length || 1;
  const [activityOpen, setActivityOpen] = useState(false);
  const activeStatuses = TASK_STATUS_ORDER.filter((s) => statusCounts[s] > 0);

  return (
    <article className="min-w-0 w-full space-y-3">
      <header className="space-y-2 border-b border-border pb-3">
        <BreadcrumbNav
          items={[
            { label: "Experiments", onClick: onBack },
            { label: experiment.name },
          ]}
        />
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <ExperimentStatusBadge status={effectiveStatus} />
              <h1 className="text-lg font-semibold leading-tight text-primary">{experiment.name}</h1>
            </div>
            {experiment.description ? (
              <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-ink-soft">{experiment.description}</p>
            ) : null}
          </div>
          <ExperimentDetailToolbar
            experiment={experiment}
            activityCount={experiment.activityHistory.length}
            onActivity={() => setActivityOpen(true)}
            onEdit={onEdit}
            onClone={onClone}
            onArchive={onArchive}
            onDelete={onDelete}
            onChangeStatus={onChangeStatus}
            onCreateTask={() => openCreateTask(experiment.id)}
          />
        </div>
      </header>

      <section
        aria-label="Experiment summary"
        className="rounded-lg border border-[#e8e8e8] bg-surface p-3"
      >
        <div className="grid gap-3 xl:grid-cols-12">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs xl:col-span-5">
            <Meta label="Objective" value={experiment.objective} className="col-span-2" />
            <Meta label="Owner" value={experiment.owner} />
            <Meta label="Base model" value={experiment.baseModel} />
            <Meta label="Dataset" value={experiment.dataset} className="col-span-2" />
            <Meta label="Success metric" value={experiment.successMetric} />
            <Meta label="Threshold" value={experiment.evaluationThreshold} />
            <Meta label="Created" value={formatDateTime(experiment.createdAt)} />
            <Meta label="Updated" value={formatDateTime(experiment.updatedAt)} />
            {experiment.tags.length > 0 ? (
              <div className="col-span-2">
                <dt className="font-medium text-ink-faint">Tags</dt>
                <dd className="mt-1 flex flex-wrap gap-1">
                  {experiment.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary-strong"
                    >
                      {tag}
                    </span>
                  ))}
                </dd>
              </div>
            ) : null}
            <div className="col-span-2">
              <dt className="font-medium text-ink-faint">Notes</dt>
              <dd className="mt-0.5 line-clamp-2 text-ink">
                {experiment.notes ? (
                  experiment.notes
                ) : (
                  <span className="text-ink-faint italic">No notes yet</span>
                )}
              </dd>
              <Link
                href={`/notes/${experiment.id}`}
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <NotebookPen className="size-3.5" />
                {experiment.notes ? "Open notes" : "Add notes"}
              </Link>
            </div>
          </dl>

          <div className="space-y-2 xl:col-span-4">
            <p className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">Performance</p>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 xl:grid-cols-3">
              <Kpi label="Tasks" value={stats.totalTasks} />
              <Kpi label="Running" value={stats.runningTasks} accent={stats.runningTasks > 0} />
              <Kpi label="Queued" value={stats.queuedTasks} />
              <Kpi label="Done" value={stats.completedTasks} />
              <Kpi label="Failed" value={stats.failedTasks} warn={stats.failedTasks > 0} />
              <Kpi
                label="Best"
                value={experiment.bestScore > 0 ? `${experiment.bestScore}%` : "—"}
              />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-[11px] text-ink-soft">
                <span>Overall progress</span>
                <span className="font-medium tabular-nums text-ink">{stats.overallProgress}%</span>
              </div>
              <Progress value={stats.overallProgress} className="h-1.5" />
              <p className="mt-1 text-[11px] text-ink-faint">
                Avg duration {formatDuration(stats.averageDurationMs)}
              </p>
            </div>
          </div>

          <div className="xl:col-span-3">
            <p className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
              Task distribution
            </p>
            {relatedTasks.length === 0 ? (
              <p className="text-xs text-ink-soft">No tasks yet.</p>
            ) : (
              <>
                <div className="flex h-2 overflow-hidden rounded-full bg-[#ebebeb]">
                  {activeStatuses.map((status) => (
                    <div
                      key={status}
                      className={cn(statusBarColors[status], "h-full")}
                      style={{ width: `${(statusCounts[status] / totalForBar) * 100}%` }}
                      title={`${status}: ${statusCounts[status]}`}
                    />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                  {activeStatuses.map((status) => (
                    <span key={status} className="inline-flex items-center gap-1 text-[11px] text-ink-soft">
                      <span className={cn("size-1.5 rounded-full", statusBarColors[status])} />
                      {status}
                      <span className="font-semibold tabular-nums text-primary">{statusCounts[status]}</span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      <section aria-label="Related tasks" className="min-h-0">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-primary">
            Related tasks
            <span className="ml-2 text-[13px] font-normal tabular-nums text-ink-soft">({stats.totalTasks})</span>
          </h2>
        </div>
        {relatedTasks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
            <p className="text-sm font-medium text-primary">No tasks in this experiment yet</p>
            <p className="mt-1 text-[13px] text-ink-soft">
              Create a task to start fine-tuning, evaluation, or inference for this experiment.
            </p>
            <Button type="button" size="sm" className="mt-3" onClick={() => openCreateTask(experiment.id)}>
              <Plus className="size-4" />
              Create Task
            </Button>
          </div>
        ) : (
          <TaskTable
            tasks={relatedTasks}
            onView={setSelectedTaskId}
            onStart={startTask}
            onPause={pauseTask}
            onStop={stopTask}
            onRetry={retryTask}
            onClone={cloneTask}
            onDelete={deleteTask}
            onCreateClick={() => openCreateTask(experiment.id)}
          />
        )}
      </section>

      <ExperimentActivityModal
        open={activityOpen}
        experiment={experiment}
        onClose={() => setActivityOpen(false)}
      />

      <CreateTaskSheet
        key={isCreateTaskOpen ? "create-task-open" : "create-task-closed"}
        open={isCreateTaskOpen}
        experiments={experiments}
        defaultExperimentId={createTaskPresetExperimentId ?? experiment.id}
        onClose={closeCreateTask}
        onSubmit={(input: CreateTaskInput) => {
          createTask(input);
        }}
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
    </article>
  );
}

function Meta({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  if (className?.includes("col-span")) {
    return (
      <div className={className}>
        <dt className="font-medium text-ink-faint">{label}</dt>
        <dd className="mt-0.5 text-ink">{value || "—"}</dd>
      </div>
    );
  }
  return (
    <>
      <dt className="font-medium text-ink-faint">{label}</dt>
      <dd className="truncate text-ink">{value || "—"}</dd>
    </>
  );
}

function Kpi({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="rounded-md bg-white px-2 py-1.5 text-center shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <p className="text-[10px] text-ink-faint">{label}</p>
      <p
        className={cn(
          "text-sm font-semibold tabular-nums leading-tight",
          warn ? "text-danger" : accent ? "text-warning" : "text-primary"
        )}
      >
        {value}
      </p>
    </div>
  );
}
