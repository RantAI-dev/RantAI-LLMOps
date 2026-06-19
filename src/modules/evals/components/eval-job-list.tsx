"use client";

import { CheckCircle2, CircleAlert, Loader2 } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import type { EvalJob } from "@/lib/evals";
import { isEvalActive } from "@/modules/evals/hooks/use-evals";
import { cn } from "@/lib/utils";

function pct(score: number): string {
  return `${(score * 100).toFixed(1)}%`;
}

export function EvalJobList({ jobs }: { jobs: EvalJob[] }) {
  if (jobs.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[13px] text-ink-soft">
        Belum ada evaluasi. Jalankan satu di atas — skornya muncul di sini.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {jobs.map((job) => {
        const active = isEvalActive(job.status);
        const failed = job.status.toUpperCase() === "FAILED";
        return (
          <div key={job.id} className="rounded-xl border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">
                  {job.model?.split("/").pop() ?? "—"}
                </p>
                <p className="truncate text-[12px] text-ink-soft">{job.benchmark ?? "—"}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {job.scores.map((s) => (
                  <span
                    key={s.type}
                    className="rounded-md bg-primary-soft px-2 py-1 text-sm font-semibold text-primary tabular-nums"
                    title={`${s.type} accuracy`}
                  >
                    {pct(s.score)}
                  </span>
                ))}
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
                  {!active && !failed && job.scores.length === 0 ? "scoring…" : job.status}
                </span>
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
          </div>
        );
      })}
    </div>
  );
}
