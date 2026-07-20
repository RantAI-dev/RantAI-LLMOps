"use client";

import { Check, ChevronDown, ChevronRight, Copy, Loader2, Maximize2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { copyText } from "@/lib/copy-text";
import { cn } from "@/lib/utils";
import { GpuMeters } from "@/modules/compute/components/gpu-meters";
import { parseLoss } from "@/modules/finetune/lib/parse-loss";

/**
 * Live training monitor for one job: polls the job's raw output (`provider_logs`,
 * i.e. the Unsloth/HF trainer stdout) while it runs, parses the per-step training
 * loss into a sparkline, and tails the raw log — so a user can SEE it's really
 * working, not just a spinner. Collapses to a one-line summary when idle.
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

/** Small toolbar button used above both log panes. */
function LogAction({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-1 rounded border border-input px-1.5 py-0.5 text-[11px] text-ink-soft hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </button>
  );
}

/** The log itself — shared by the inline pane and the expanded overlay. */
function LogPane({
  text,
  className,
  paneRef,
}: {
  text: string;
  className?: string;
  paneRef?: React.RefObject<HTMLPreElement | null>;
}) {
  return (
    <pre
      ref={paneRef}
      className={cn(
        "overflow-auto rounded-md bg-zinc-900 p-2.5 font-mono text-[11px] leading-4 whitespace-pre-wrap break-words text-zinc-200",
        className
      )}
    >
      {text}
    </pre>
  );
}

export function TrainingMonitor({ jobId, active }: { jobId: string; active: boolean }) {
  const [open, setOpen] = useState(active);
  const [output, setOutput] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  const expandedRef = useRef<HTMLPreElement>(null);

  const handleCopy = async () => {
    if (await copyText(output)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  };

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

  // Keep the log pinned to the bottom as it grows while running (both panes).
  useEffect(() => {
    if (!active) return;
    for (const el of [logRef.current, expandedRef.current]) {
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [output, active, expanded]);

  // Escape closes the expanded log.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const losses = useMemo(() => parseLoss(output), [output]);
  const lastLoss = losses.length ? losses[losses.length - 1] : null;
  const lineCount = useMemo(() => (output ? output.split("\n").length : 0), [output]);
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
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-ink-soft">Log lengkap · {lineCount} baris</span>
                <div className="flex items-center gap-1">
                  <LogAction onClick={handleCopy} title="Salin seluruh log">
                    {copied ? <Check className="size-3 text-primary" aria-hidden /> : <Copy className="size-3" aria-hidden />}
                    {copied ? "Tersalin" : "Salin"}
                  </LogAction>
                  <LogAction onClick={() => setExpanded(true)} title="Perbesar (Esc untuk menutup)">
                    <Maximize2 className="size-3" aria-hidden /> Perbesar
                  </LogAction>
                </div>
              </div>
              {/* The whole log, not a tail: the decisive lines (model id, precision,
                  the traceback) are usually far above the last 40 and were being
                  cut off exactly when they were needed. */}
              <LogPane text={output} paneRef={logRef} className="max-h-64" />
            </div>
          ) : (
            <p className="flex items-center gap-1.5 rounded-md bg-surface-2 px-3 py-2 text-[11px] leading-4 text-ink-soft">
              {active ? <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden /> : null}
              {active
                ? "Menyiapkan training — build venv + download model. Log & kurva loss muncul saat langkah pertama (bisa beberapa menit)."
                : "Belum ada log untuk job ini."}
            </p>
          )}

          {expanded ? (
            <div
              className="fixed inset-0 z-50 flex flex-col bg-black/70 p-4 sm:p-8"
              onClick={() => setExpanded(false)}
              role="presentation"
            >
              <div
                className="flex min-h-0 w-full flex-1 flex-col rounded-lg border border-hairline-2 bg-background p-3 shadow-lg"
                onClick={(e) => e.stopPropagation()}
                role="presentation"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-ink">
                    Log training · {lineCount} baris
                  </span>
                  <div className="flex items-center gap-1">
                    <LogAction onClick={handleCopy} title="Salin seluruh log">
                      {copied ? <Check className="size-3 text-primary" aria-hidden /> : <Copy className="size-3" aria-hidden />}
                      {copied ? "Tersalin" : "Salin"}
                    </LogAction>
                    <button
                      type="button"
                      onClick={() => setExpanded(false)}
                      aria-label="Tutup"
                      className="grid size-7 place-items-center rounded-md text-ink-soft hover:bg-surface-2 hover:text-ink"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                </div>
                <LogPane text={output} paneRef={expandedRef} className="min-h-0 flex-1 text-[12px]" />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
