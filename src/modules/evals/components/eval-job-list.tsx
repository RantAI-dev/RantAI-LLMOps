"use client";

import { CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Clock, Loader2 } from "lucide-react";
import { useState } from "react";

import { JobLogPanel, useJobOutput } from "@/components/job-log";
import { Progress } from "@/components/ui/progress";
import type { EvalJob } from "@/lib/evals";
import { formatAppDateTime } from "@/lib/tl-datetime";
import { isEvalActive } from "@/modules/evals/hooks/use-evals";
import { cn } from "@/lib/utils";

/**
 * One job's log, fetched only once opened — a list can hold many jobs and there
 * is no reason to poll the ones nobody is looking at.
 */
function EvalJobLog({ jobId, active, failed }: { jobId: string; active: boolean; failed: boolean }) {
  // A failed run is the one people need to read, so open it by default rather
  // than leaving the reason one more click away.
  const [open, setOpen] = useState(failed);
  const output = useJobOutput(jobId, active, open);

  return (
    <div className="mt-2 border-t border-hairline-2 pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[12px] font-medium text-ink-soft hover:text-ink"
      >
        {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
        Log
        {failed ? <span className="ml-1 text-danger">· lihat penyebab gagal</span> : null}
      </button>
      {open ? (
        <div className="mt-2">
          <JobLogPanel
            output={output}
            active={active}
            emptyLabel={active ? "Menyiapkan evaluasi — build venv + muat model…" : "Belum ada log untuk job ini."}
          />
        </div>
      ) : null}
    </div>
  );
}

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
        // Prefer the finish time (history); fall back to start while still running.
        const finished = !active && !!job.finishedAt;
        const when = finished ? job.finishedAt : job.startedAt;
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
            {when ? (
              <p className="mt-2 flex items-center gap-1 text-[11px] text-ink-soft">
                <Clock className="size-3 shrink-0" aria-hidden />
                {finished ? "Selesai" : "Mulai"} {formatAppDateTime(when)} WIB
              </p>
            ) : null}
            <EvalJobLog jobId={job.id} active={active} failed={failed} />
          </div>
        );
      })}
    </div>
  );
}
