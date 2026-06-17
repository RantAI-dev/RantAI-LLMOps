"use client";

import {
  Copy,
  Download,
  Pause,
  Play,
  RotateCw,
  Square,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MockBadge } from "@/components/ui/mock-badge";
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
import type { Task, TaskStatus, TaskTimelineStep } from "@/modules/tasks/types";
import { cn } from "@/lib/utils";

import { TaskStatusBadge } from "./task-status-badge";

const ZERO_RESOURCE = { gpu: 0, vram: 0, cpu: 0, memory: 0, tokensProcessed: 0, estimatedCost: 0 };

type TaskDetailDrawerProps = {
  task: Task | null;
  onClose: () => void;
  onStart: (id: string) => void;
  onPause: (id: string) => void;
  onStop: (id: string) => void;
  onRetry: (id: string) => void;
  onClone: (id: string) => void;
  onDelete: (id: string) => void;
};

export function TaskDetailDrawer({
  task,
  onClose,
  onStart,
  onPause,
  onStop,
  onRetry,
  onClone,
  onDelete,
}: TaskDetailDrawerProps) {
  if (!task) return null;

  const run = latestRun(task);
  const status = taskStatus(task);
  const canStart = status === "Draft" || status === "Queued" || status === "Paused";
  const canPause = status === "Running";
  const canStop = status === "Running" || status === "Paused" || status === "Retrying";
  const canRetry = status === "Failed";
  const hp = task.hyperparameters;
  const ru = run?.resourceUsage ?? ZERO_RESOURCE;
  const startLabel = status === "Draft" ? "Run" : status === "Paused" ? "Resume" : "Start";

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
            <span className="rounded bg-primary-soft px-2 py-0.5 text-[12px] font-medium text-primary">
              {task.type}
            </span>
          </div>
          <SheetTitle className="truncate text-xl text-primary">{task.name}</SheetTitle>
          <SheetDescription>{task.experimentName}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-wrap gap-2 border-b border-border px-5 py-3">
          {canStart ? (
            <Button type="button" size="sm" onClick={() => onStart(task.id)}>
              <Play className="size-3.5" /> {startLabel}
            </Button>
          ) : null}
          {canPause ? (
            <Button type="button" size="sm" variant="outline" onClick={() => onPause(task.id)}>
              <Pause className="size-3.5" /> Pause
            </Button>
          ) : null}
          {canStop ? (
            <Button type="button" size="sm" variant="outline" onClick={() => onStop(task.id)}>
              <Square className="size-3.5" /> Stop
            </Button>
          ) : null}
          {canRetry ? (
            <Button type="button" size="sm" variant="outline" onClick={() => onRetry(task.id)}>
              <RotateCw className="size-3.5" /> Retry
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="ghost" onClick={() => onClone(task.id)}>
            <Copy className="size-3.5" /> Clone
          </Button>
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
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[14px]">
              <Meta label="Experiment" value={task.experimentName} full />
              <Meta label="Owner" value={task.owner} />
              <Meta label="Priority" value={task.priority} />
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
            <dl className="grid grid-cols-1 gap-2 text-[14px] sm:grid-cols-2">
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
                <span>LR: {hp.learningRate}</span>
                <span>Max tokens: {hp.maxToken}</span>
                <span>Temperature: {hp.temperature}</span>
                <span>Checkpoint: {hp.enableCheckpoint ? "On" : "Off"}</span>
                <span className="col-span-2">
                  Eval after run: {hp.enableEvaluationAfterRun ? "Enabled" : "Disabled"}
                </span>
              </div>
            </div>
          </Section>

          <Section title="Runs">
            {task.runs.length === 0 ? (
              <p className="text-[14px] text-ink-soft">
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
              <p className="text-[14px] text-ink-soft">No runs yet.</p>
            )}
          </Section>

          <Section title="Resource Usage">
            <div className="mb-3 flex items-center gap-2">
              <MockBadge />
              <p className="text-[12px] text-ink-soft">
                TL tidak meng-expose metrik GPU realtime maupun estimasi biaya per job — angka di
                bawah masih contoh.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <ResourceBar label="GPU" value={ru.gpu} />
              <ResourceBar label="VRAM" value={ru.vram} />
              <ResourceBar label="CPU" value={ru.cpu} />
              <ResourceBar label="Memory" value={ru.memory} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-[14px] text-ink-soft">
              <span>Tokens: {ru.tokensProcessed.toLocaleString()}</span>
              <span className="inline-flex items-center gap-1.5">
                Est. cost: ${ru.estimatedCost.toFixed(2)} <MockBadge />
              </span>
            </div>
          </Section>

          <Section title="Logs">
            <div className="max-h-48 overflow-y-auto rounded-md bg-[#1a1a1a] p-3 font-mono text-[12px] leading-5 text-[#e4e4e7]">
              {!run || run.logs.length === 0 ? (
                <p className="text-ink-faint-strong">No logs yet.</p>
              ) : (
                run.logs.map((log, i) => (
                  <p key={`${log.time}-${i}`}>
                    <span className="text-ink-faint">[{log.time}]</span> {log.message}
                  </p>
                ))
              )}
            </div>
          </Section>

          <Section title="Output / Artifacts">
            {!run || run.artifacts.length === 0 ? (
              <p className="text-[14px] text-ink-soft">
                No artifacts yet. Outputs appear when the run completes.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {run.artifacts.map((artifact) => (
                  <Card key={artifact.id} className="shadow-sm">
                    <CardHeader className="pb-1">
                      <CardTitle className="text-[14px] font-medium text-primary">
                        {artifact.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between pt-0">
                      <div className="text-[12px] text-ink-soft">
                        <p>{artifact.type}</p>
                        <p>{artifact.size}</p>
                      </div>
                      <Button type="button" variant="outline" size="xs">
                        <Download className="size-3" />
                      </Button>
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
      <dt className="text-[12px] font-medium uppercase tracking-wide text-ink-soft">
        {label}
      </dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  );
}

function ResourceBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[13px] text-ink-soft">
        <span>{label}</span>
        <span className="tabular-nums">{value}%</span>
      </div>
      <Progress value={value} />
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
              <p className="text-[14px] font-medium text-ink">{step.label}</p>
              {step.timestamp ? (
                <p className="text-[12px] text-ink-soft">{step.timestamp}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
