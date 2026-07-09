"use client";

import { CheckCircle2, CircleAlert, Loader2, Trash2 } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import type { TrainingJob } from "@/lib/finetune";
import { isJobActive } from "@/modules/finetune/hooks/use-finetune";
import { TrainingMonitor } from "@/modules/finetune/components/training-monitor";
import { cn } from "@/lib/utils";

function StatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const active = isJobActive(s);
  const failed = s === "FAILED" || s === "STOPPED";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        active && "bg-primary-soft text-primary",
        failed && "bg-danger-soft text-danger",
        !active && !failed && "bg-emerald-50 text-emerald-700"
      )}
    >
      {active ? (
        <Loader2 className="size-3 animate-spin" aria-hidden />
      ) : failed ? (
        <CircleAlert className="size-3" aria-hidden />
      ) : (
        <CheckCircle2 className="size-3" aria-hidden />
      )}
      {status}
    </span>
  );
}

export function JobList({
  jobs,
  onStop,
  onDelete,
}: {
  jobs: TrainingJob[];
  onStop: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (jobs.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[13px] text-ink-soft">
        Belum ada job fine-tuning. Mulai satu di atas — hasilnya muncul di sini.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {jobs.map((job) => {
        const active = isJobActive(job.status);
        return (
          <div key={job.id} className="rounded-xl border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{job.name}</p>
                <p className="truncate text-[12px] text-ink-soft">
                  {job.model ?? "—"} · {job.dataset ?? "—"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusBadge status={job.status} />
                {active ? (
                  <button
                    type="button"
                    onClick={() => onStop(job.id)}
                    className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft hover:bg-surface-2 hover:text-danger"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onDelete(job.id)}
                    aria-label="Delete job"
                    className="grid size-7 place-items-center rounded-md text-ink-soft hover:bg-surface-2 hover:text-danger"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                )}
              </div>
            </div>
            {active ? (
              <div className="mt-2 flex items-center gap-2">
                <Progress value={job.progress} className="h-1.5 flex-1" />
                <span className="text-[11px] tabular-nums text-ink-soft">
                  {Math.round(job.progress)}%
                </span>
              </div>
            ) : null}
            <TrainingMonitor jobId={job.id} active={active} />
          </div>
        );
      })}
    </div>
  );
}
