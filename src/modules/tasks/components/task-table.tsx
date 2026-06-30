"use client";

import { Eye, MoreHorizontal, Play, Square, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { taskUi } from "@/modules/tasks/constants/task-ui";
import { formatDateTime, formatDuration, latestRun, taskProgress, taskStatus } from "@/modules/tasks/lib/utils";
import type { Task, TaskStatus } from "@/modules/tasks/types";
import { cn } from "@/lib/utils";

import { TaskStatusBadge } from "./task-status-badge";

type TaskTableProps = {
  tasks: Task[];
  onView: (id: string) => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
  onCreateClick: () => void;
};

const outputStyles: Record<string, string> = {
  None: "text-ink-faint",
  Pending: "text-warning",
  Ready: "text-success",
  Failed: "text-danger",
};

export function TaskTable({
  tasks,
  onView,
  onStop,
  onDelete,
  onCreateClick,
}: TaskTableProps) {
  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/10 px-6 py-16 text-center">
        <div className="mb-4 grid size-14 place-items-center rounded-full bg-primary-soft">
          <Play className="size-6 text-primary" />
        </div>
        <h3 className={cn("text-primary", taskUi.section)}>No tasks found</h3>
        <p className={cn("mt-2 max-w-md", taskUi.subheading)}>
          Create your first AI task to start running model operations, evaluations, or training jobs.
        </p>
        <Button type="button" className="mt-6" onClick={onCreateClick}>
          Create Task
        </Button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Table className="min-w-[1100px]">
        <TableHeader>
          <TableRow className="bg-surface">
            <TableHead>Task Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Experiment</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="min-w-[120px]">Progress</TableHead>
            <TableHead>Compute</TableHead>
            <TableHead>Engine</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Output</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
            {tasks.map((task) => {
              const run = latestRun(task);
              const status = taskStatus(task);
              const progress = taskProgress(task);
              const outputStatus = run?.outputStatus ?? "None";
              return (
              <TableRow
                key={task.id}
                className="cursor-pointer hover:bg-primary-tint-2"
                onClick={() => onView(task.id)}
              >
                <TableCell className="max-w-[220px]">
                  <p className="truncate font-medium text-primary">{task.name}</p>
                  <p className="truncate text-xs text-ink-soft">
                    {task.id}
                    {task.runs.length > 0 ? ` · ${task.runs.length} run${task.runs.length > 1 ? "s" : ""}` : " · no runs"}
                  </p>
                </TableCell>
                <TableCell className="text-ink">{task.type}</TableCell>
                <TableCell className="text-ink-soft">{task.experimentName}</TableCell>
                <TableCell>
                  <TaskStatusBadge status={status} />
                </TableCell>
                <TableCell>
                  <div className="flex min-w-[100px] flex-col gap-1">
                    <span className="text-xs tabular-nums text-ink-soft">{progress}%</span>
                    <Progress value={progress} />
                  </div>
                </TableCell>
                <TableCell className="text-[13px] text-ink-soft">{task.computeTarget}</TableCell>
                <TableCell className="text-[13px] text-ink-soft">{task.engine}</TableCell>
                <TableCell className="text-[13px] tabular-nums text-ink-soft">
                  {formatDateTime(run?.startedAt)}
                </TableCell>
                <TableCell className="text-[13px] tabular-nums text-ink-soft">
                  {formatDuration(run?.durationMs ?? 0)}
                </TableCell>
                <TableCell className={cn("text-[13px] font-medium", outputStyles[outputStatus])}>
                  {outputStatus}
                </TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <TaskRowActions
                    status={status}
                    onView={() => onView(task.id)}
                    onStop={() => onStop(task.id)}
                    onDelete={() => onDelete(task.id)}
                  />
                </TableCell>
              </TableRow>
              );
            })}
        </TableBody>
      </Table>
    </div>
  );
}

function TaskRowActions({
  status,
  onView,
  onStop,
  onDelete,
}: {
  status: TaskStatus;
  onView: () => void;
  onStop: () => void;
  onDelete: () => void;
}) {
  // v0.40.0: only Stop (cancel) and Delete are real for compute-provider jobs.
  const canStop = status === "Running" || status === "Paused" || status === "Retrying";

  return (
    <div className="inline-flex items-center gap-1">
      <Button type="button" variant="ghost" size="icon-xs" onClick={onView} title="View detail">
        <Eye className="size-3.5" />
      </Button>
      {canStop ? (
        <Button type="button" variant="ghost" size="icon-xs" onClick={onStop} title="Stop">
          <Square className="size-3.5" />
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button type="button" variant="ghost" size="icon-xs" title="More" aria-label="More actions">
              <MoreHorizontal className="size-3.5" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-[168px]">
          <DropdownMenuItem className="text-destructive" onClick={onDelete}>
            <Trash2 className="size-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
