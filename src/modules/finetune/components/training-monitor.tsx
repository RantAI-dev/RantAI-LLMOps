"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { JobLogPanel, useJobOutput } from "@/components/job-log";
import { GpuMeters } from "@/modules/compute/components/gpu-meters";
import { parseEvalLoss, parseLoss } from "@/modules/finetune/lib/parse-loss";

/**
 * Live training monitor for one job: polls the job's raw output (`provider_logs`,
 * i.e. the Unsloth/HF trainer stdout) while it runs, parses the per-step training
 * loss into a sparkline, and shows the log — so a user can SEE it's really
 * working, not just a spinner. Collapses to a one-line summary when idle.
 *
 * The log itself lives in JobLogPanel, shared with the evals list: a failed job
 * is only diagnosable if its log is on screen, and that is true of every kind of
 * job, not just training.
 */

function LossSparkline({ values, evalValues = [] }: { values: number[]; evalValues?: number[] }) {
  const w = 300;
  const h = 48;
  const pad = 3;
  // Share the y-scale across both series so train and eval are directly comparable.
  const all = evalValues.length ? [...values, ...evalValues] : values;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const toPoints = (series: number[]) =>
    series
      .map((v, i) => {
        const x = pad + (series.length > 1 ? i / (series.length - 1) : 0) * (w - 2 * pad);
        const y = pad + (1 - (v - min) / span) * (h - 2 * pad);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-12 w-full">
      <polyline className="text-primary" points={toPoints(values)} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      {evalValues.length >= 2 ? (
        <polyline className="text-warning" points={toPoints(evalValues)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
      ) : null}
    </svg>
  );
}

export function TrainingMonitor({ jobId, active }: { jobId: string; active: boolean }) {
  const [open, setOpen] = useState(active);
  const output = useJobOutput(jobId, active, open);

  const losses = useMemo(() => parseLoss(output), [output]);
  const evalLosses = useMemo(() => parseEvalLoss(output), [output]);
  const lastLoss = losses.length ? losses[losses.length - 1] : null;
  const lastEval = evalLosses.length ? evalLosses[evalLosses.length - 1] : null;

  return (
    <div className="mt-2 border-t border-hairline-2 pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[12px] font-medium text-ink-soft hover:text-ink"
      >
        {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
        Log &amp; loss
        {lastLoss != null ? (
          <span className="ml-1 tabular-nums text-ink-soft">
            · loss {lastLoss.toFixed(3)}
            {lastEval != null ? ` · eval ${lastEval.toFixed(3)}` : ""}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="mt-2 space-y-2">
          {losses.length >= 2 ? (
            <div className="rounded-md border border-hairline-2 bg-background p-2">
              <div className="mb-1 flex items-center justify-between text-[11px] text-ink-soft">
                <span>Loss · {losses.length} steps</span>
                <span className="tabular-nums">
                  {losses[0].toFixed(3)} → {lastLoss?.toFixed(3)}
                </span>
              </div>
              <LossSparkline values={losses} evalValues={evalLosses} />
              {evalLosses.length >= 2 ? (
                <div className="mt-1 flex items-center gap-3 text-[10px]">
                  <span className="text-primary">━ Training</span>
                  <span className="text-warning">┄ Eval</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {active ? (
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-ink-soft">GPU (live)</p>
              <GpuMeters compact intervalMs={3000} />
            </div>
          ) : null}

          <JobLogPanel
            output={output}
            active={active}
            emptyLabel={
              active
                ? "Preparing training — building venv and downloading model. Logs and the loss curve appear at the first step (may take a few minutes)."
                : "No logs for this job yet."
            }
          />
        </div>
      ) : null}
    </div>
  );
}
