"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { JobLogPanel, useJobOutput } from "@/components/job-log";
import { GpuMeters } from "@/modules/compute/components/gpu-meters";
import { parseLoss } from "@/modules/finetune/lib/parse-loss";

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

function LossSparkline({ values }: { values: number[] }) {
  const w = 300;
  const h = 48;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
      const y = pad + (1 - (v - min) / span) * (h - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-12 w-full text-accent">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function TrainingMonitor({ jobId, active }: { jobId: string; active: boolean }) {
  const [open, setOpen] = useState(active);
  const output = useJobOutput(jobId, active, open);

  const losses = useMemo(() => parseLoss(output), [output]);
  const lastLoss = losses.length ? losses[losses.length - 1] : null;

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
          <span className="ml-1 tabular-nums text-ink-soft">· loss {lastLoss.toFixed(3)}</span>
        ) : null}
      </button>

      {open ? (
        <div className="mt-2 space-y-2">
          {losses.length >= 2 ? (
            <div className="rounded-md border border-hairline-2 bg-background p-2">
              <div className="mb-1 flex items-center justify-between text-[11px] text-ink-soft">
                <span>Training loss · {losses.length} langkah</span>
                <span className="tabular-nums">
                  {losses[0].toFixed(3)} → {lastLoss?.toFixed(3)}
                </span>
              </div>
              <LossSparkline values={losses} />
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
                ? "Menyiapkan training — build venv + download model. Log & kurva loss muncul saat langkah pertama (bisa beberapa menit)."
                : "Belum ada log untuk job ini."
            }
          />
        </div>
      ) : null}
    </div>
  );
}
