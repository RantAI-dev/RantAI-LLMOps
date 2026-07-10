"use client";

import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { GpuMeters } from "@/modules/compute/components/gpu-meters";

/**
 * Live training monitor for one job: polls the job's raw output (`provider_logs`,
 * i.e. the Unsloth/HF trainer stdout) while it runs, parses the per-step training
 * loss into a sparkline, and tails the raw log — so a user can SEE it's really
 * working, not just a spinner. Collapses to a one-line summary when idle.
 */

/** Pull the HF Trainer's per-step `'loss': X` values out of the raw stdout. */
function parseLoss(text: string): number[] {
  const out: number[] = [];
  const re = /['"]loss['"]\s*:\s*([0-9]+(?:\.[0-9]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const v = Number(m[1]);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

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
  const [output, setOutput] = useState("");
  const logRef = useRef<HTMLPreElement>(null);

  // Fetch on open; live-tail every 3s while the job runs.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/tasks/${encodeURIComponent(jobId)}/output`, { cache: "no-store" });
        const d = (await res.json()) as { output?: string };
        if (!cancelled) setOutput(typeof d.output === "string" ? d.output : "");
      } catch {
        /* keep last output on a transient error */
      }
    };
    void load();
    const timer = active ? setInterval(load, 3000) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [open, active, jobId]);

  // Keep the log pinned to the bottom as it grows while running.
  useEffect(() => {
    if (active && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [output, active]);

  const losses = useMemo(() => parseLoss(output), [output]);
  const lastLoss = losses.length ? losses[losses.length - 1] : null;
  const tail = useMemo(() => output.split("\n").slice(-40).join("\n"), [output]);
  // TL returns "No log files found" during LAUNCHING (venv build + model
  // download), before the trainer writes anything — treat that as "no log yet".
  const hasRealLog = output.trim().length > 0 && !/no log files? found/i.test(output);

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

          {hasRealLog ? (
            <pre
              ref={logRef}
              className="max-h-48 overflow-auto rounded-md bg-zinc-900 p-2.5 font-mono text-[11px] leading-4 whitespace-pre-wrap break-words text-zinc-200"
            >
              {tail}
            </pre>
          ) : (
            <p className="flex items-center gap-1.5 rounded-md bg-surface-2 px-3 py-2 text-[11px] leading-4 text-ink-soft">
              {active ? <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden /> : null}
              {active
                ? "Menyiapkan training — build venv + download model. Log & kurva loss muncul saat langkah pertama (bisa beberapa menit)."
                : "Belum ada log untuk job ini."}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
