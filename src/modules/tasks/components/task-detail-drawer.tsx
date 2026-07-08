"use client";

import { useEffect, useState } from "react";
import { Download, Square, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { taskUi } from "@/modules/tasks/constants/task-ui";
import { formatDateTime, formatDuration, latestRun, taskStatus } from "@/modules/tasks/lib/utils";
import type { Task, TaskLogEntry, TaskStatus, TaskTimelineStep } from "@/modules/tasks/types";
import { cn } from "@/lib/utils";

import { TaskStatusBadge } from "./task-status-badge";


type TaskDetailDrawerProps = {
  task: Task | null;
  onClose: () => void;
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
};

export function TaskDetailDrawer({
  task,
  onClose,
  onStop,
  onDelete,
}: TaskDetailDrawerProps) {
  if (!task) return null;

  const run = latestRun(task);
  const status = taskStatus(task);
  const canStop = status === "Running" || status === "Paused" || status === "Retrying";
  const hp = task.hyperparameters;

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-5 py-4 text-left">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <TaskStatusBadge status={status} />
            <span className="rounded bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">
              {task.type}
            </span>
          </div>
          <SheetTitle className="truncate text-xl text-primary">{task.name}</SheetTitle>
          <SheetDescription>{task.id}</SheetDescription>
        </SheetHeader>

        {/* v0.40.0: jobs run via the compute provider — Stop (cancel) and Delete
            are the real, supported actions. Start/Pause/Retry/Clone don't map to
            REMOTE jobs (you start a run from Fine-tune/Evals), so they're gone. */}
        <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3">
          {canStop ? (
            <Button type="button" size="sm" variant="outline" onClick={() => onStop(task.id)}>
              <Square className="size-3.5" /> Stop
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="destructive"
            onClick={() => onDelete(task.id)}
          >
            <Trash2 className="size-3.5" /> Delete
          </Button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <Section title="Task Overview">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Meta label="Owner" value={task.owner} />
              <Meta label="Created" value={formatDateTime(task.createdAt)} />
              <Meta label="Started" value={formatDateTime(run?.startedAt)} />
              <Meta label="Finished" value={formatDateTime(run?.finishedAt)} />
              <Meta label="Duration" value={formatDuration(run?.durationMs ?? 0)} />
            </dl>
            {status === "Running" || status === "Retrying" ? (
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-[13px] text-ink-soft">
                  <span>Progress</span>
                  <span className="tabular-nums">{run?.progress ?? 0}%</span>
                </div>
                <Progress value={run?.progress ?? 0} />
              </div>
            ) : null}
          </Section>

          <Section title="Configuration">
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <Meta label="Base Model" value={task.baseModel} full />
              <Meta label="Dataset" value={task.dataset} full />
              <Meta label="Processing engine" value={task.engine} />
              <Meta label="Runtime" value={task.runtime} />
              <Meta label="Compute Target" value={task.computeTarget} />
              <Meta label="GPU Required" value={String(task.gpuRequired)} />
            </dl>
            <div className="mt-3 rounded-md border border-border bg-surface p-3 text-[13px]">
              <p className="mb-2 font-medium text-primary">Hyperparameters</p>
              <div className="grid grid-cols-2 gap-2 text-ink-soft">
                <span>Epochs: {hp.epochs}</span>
                <span>Batch: {hp.batchSize}</span>
                <span>Learning rate: {hp.learningRate}</span>
                <span>Max steps: {hp.maxToken}</span>
                {task.loraR != null ? <span>LoRA rank (r): {task.loraR}</span> : null}
                {task.loraAlpha != null ? <span>LoRA alpha: {task.loraAlpha}</span> : null}
              </div>
            </div>
          </Section>

          <Section title="Runs">
            {task.runs.length === 0 ? (
              <p className="text-sm text-ink-soft">
                No runs yet. Start this task to create run #1.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {task.runs.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-[13px]"
                  >
                    <span className="font-medium text-ink">Run #{r.attempt}</span>
                    <TaskStatusBadge status={r.status} />
                    <span className="ml-auto tabular-nums text-ink-soft">
                      {formatDuration(r.durationMs)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Execution Timeline">
            {run ? (
              <Timeline steps={run.timeline} status={status} />
            ) : (
              <p className="text-sm text-ink-soft">No runs yet.</p>
            )}
          </Section>

          <Section title="Logs">
            <TaskLogs
              taskId={task.id}
              experimentId={task.experimentId}
              fallback={run?.logs ?? []}
              live={status === "Running" || status === "Retrying"}
            />
          </Section>

          <Section title="Output / Artifacts">
            {!run || run.artifacts.length === 0 ? (
              <p className="text-sm text-ink-soft">
                No artifacts yet. Outputs appear when the run completes.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {run.artifacts.map((artifact) => (
                  <Card key={artifact.id} className="shadow-sm">
                    <CardHeader className="pb-1">
                      <CardTitle className="truncate text-sm font-medium text-primary" title={artifact.name}>
                        {artifact.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <p className="text-xs text-ink-soft">{artifact.type}</p>
                      {artifact.size ? <p className="text-xs text-ink-soft">{artifact.size}</p> : null}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </Section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Real job logs from Transformer Lab (`/api/tasks/{id}/output`). Falls back to
 * the task's mock log entries for demo tasks TL doesn't have. Real logs can be
 * downloaded as a .log file (the one job artifact TL reliably serves).
 */
function TaskLogs({
  taskId,
  experimentId,
  fallback,
  live = false,
}: {
  taskId: string;
  experimentId?: string;
  fallback: TaskLogEntry[];
  live?: boolean;
}) {
  const [output, setOutput] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const qs = experimentId ? `?experimentId=${encodeURIComponent(experimentId)}` : "";
    const load = () =>
      fetch(`/api/tasks/${encodeURIComponent(taskId)}/output${qs}`, { cache: "no-store" })
        .then((r) => r.json() as Promise<{ output?: string }>)
        .then((d) => {
          if (cancelled) return;
          setOutput(typeof d.output === "string" ? d.output : "");
          setLoading(false);
        })
        .catch(() => {
          if (!cancelled) setLoading(false);
        });
    load();
    // Live-tail while the job is running so logs (loss, progress) update.
    const timer = live ? setInterval(load, 3000) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [taskId, experimentId, live]);

  const hasReal = output != null && output.trim().length > 0;

  const downloadLog = () => {
    if (!output) return;
    const blob = new Blob([output], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `job-${taskId}.log`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        {live ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary">
            <span className="size-1.5 animate-pulse rounded-full bg-primary" /> Live
          </span>
        ) : (
          <span />
        )}
        {hasReal ? (
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5" onClick={downloadLog}>
            <Download className="size-3.5" /> Download .log
          </Button>
        ) : null}
      </div>
      <div className="max-h-64 overflow-y-auto rounded-md bg-[#1a1a1a] p-3 font-mono text-xs leading-5 text-[#e4e4e7]">
        {loading ? (
          <p className="text-ink-faint-strong">Loading logs…</p>
        ) : hasReal ? (
          <pre className="whitespace-pre-wrap break-words">{output}</pre>
        ) : fallback.length > 0 ? (
          fallback.map((log, i) => (
            <p key={`${log.time}-${i}`}>
              <span className="text-ink-faint">[{log.time}]</span> {log.message}
            </p>
          ))
        ) : (
          <p className="text-ink-faint-strong">No logs yet.</p>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className={cn("mb-3 text-primary", taskUi.section)}>{title}</h3>
      {children}
    </section>
  );
}

function Meta({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-soft">
        {label}
      </dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  );
}

function Timeline({
  steps,
  status,
}: {
  steps: TaskTimelineStep[];
  status: TaskStatus;
}) {
  return (
    <ol className="space-y-0">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const stepStatus =
          step.id === "completed" && status === "Failed"
            ? "failed"
            : step.id === "completed" && status === "Cancelled"
              ? "failed"
              : step.status;

        return (
          <li key={step.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                  stepStatus === "completed" && "bg-success-soft text-success",
                  stepStatus === "active" && "bg-warning-soft text-warning ring-2 ring-warning-solid/30",
                  stepStatus === "failed" && "bg-danger-soft text-danger",
                  stepStatus === "pending" && "bg-surface-2 text-ink-faint",
                  stepStatus === "skipped" && "bg-surface-2 text-[#d4d4d8]"
                )}
              >
                {stepStatus === "completed" ? "✓" : stepStatus === "failed" ? "!" : index + 1}
              </span>
              {!isLast ? <span className="my-1 w-px flex-1 bg-border min-h-[20px]" /> : null}
            </div>
            <div className="pb-4">
              <p className="text-sm font-medium text-ink">{step.label}</p>
              {step.timestamp ? (
                <p className="text-xs text-ink-soft">{step.timestamp}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
