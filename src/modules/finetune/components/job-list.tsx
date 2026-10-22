"use client";

import { CheckCircle2, CircleAlert, Loader2, Trash2 } from "lucide-react";
import { useMemo } from "react";

import { useJobOutput } from "@/components/job-log";
import { Progress } from "@/components/ui/progress";
import type { TrainingJob } from "@/lib/finetune";
import { isJobActive, isJobFailed } from "@/modules/finetune/hooks/use-finetune";
import { TrainingMonitor } from "@/modules/finetune/components/training-monitor";
import { parseDecisionReport, type DecisionMetrics } from "@/modules/finetune/lib/parse-decision";
import { cn } from "@/lib/utils";

function StatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const active = isJobActive(s);
  const failed = isJobFailed(s);
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

const pct = (v?: number) => (v === undefined ? "—" : `${(v * 100).toFixed(1)}%`);
const fixed = (v?: number) => (v === undefined ? "—" : v.toFixed(3));

function Delta({ label, before, after, fmt }: { label: string; before?: number; after?: number; fmt: (v?: number) => string }) {
  return (
    <div>
      <p className="text-[11px] text-ink-soft">{label}</p>
      <p className="text-[13px] font-medium tabular-nums text-ink">
        <span className="text-ink-soft">{fmt(before)}</span> → {fmt(after)}
      </p>
    </div>
  );
}

/** Before/after quality of a finished decision-model job, read from its output (no extra API). */
function DecisionResult({ jobId }: { jobId: string }) {
  const output = useJobOutput(jobId, false, true);
  const r = useMemo(() => parseDecisionReport(output), [output]);
  if (!r) return null;
  const b: DecisionMetrics = r.before;
  const a: DecisionMetrics = r.after;
  return (
    <div className="mt-2 rounded-md border border-hairline-2 bg-background p-2.5">
      <p className="mb-1.5 text-[11px] text-ink-soft">
        Before → after training, on the {r.testSet === "holdout" ? "holdout (slightly optimistic)" : `separate test set (${r.testSet})`}
      </p>
      <div className="grid grid-cols-3 gap-3">
        <Delta label="Accuracy" before={b.accuracy} after={a.accuracy} fmt={pct} />
        <Delta label="Calibration error (ECE, lower is better)" before={b.ece} after={a.ece} fmt={fixed} />
        <Delta label="Every question right" before={b.record_accuracy} after={a.record_accuracy} fmt={pct} />
      </div>
    </div>
  );
}

export function JobList({
  jobs,
  onDelete,
}: {
  jobs: TrainingJob[];
  onDelete: (id: string) => void;
}) {
  if (jobs.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[13px] text-ink-soft">
        No fine-tuning jobs yet. Start one above — results appear here.
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
                <p className="truncate text-sm font-medium text-ink">
                  {job.name}
                  {job.kind === "decision" ? (
                    <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 align-middle text-[10px] font-medium text-primary">
                      Decision
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-[12px] text-ink-soft">
                  {job.model ?? "—"} · {job.dataset ?? "—"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusBadge status={job.status} />
                {active ? null : (
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
            {job.kind === "decision" && !active && job.status.toUpperCase() === "COMPLETE" ? (
              <DecisionResult jobId={job.id} />
            ) : null}
            <TrainingMonitor jobId={job.id} active={active} />
          </div>
        );
      })}
    </div>
  );
}
