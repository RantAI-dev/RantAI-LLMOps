"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2, Maximize2, X } from "lucide-react";

import { copyText } from "@/lib/copy-text";
import { cn } from "@/lib/utils";

/**
 * A Transformer Lab job's raw log, and the panel that shows it.
 *
 * Both the training monitor and the evals list need this: a job that fails is
 * only diagnosable if its log is on screen. The evals list originally showed a
 * status badge and nothing else, so a FAILED benchmark was a dead end — the
 * traceback existed, it just had nowhere to appear.
 */

/**
 * Poll a job's output while it runs, once when it doesn't.
 *
 * `enabled` exists so a list can mount many of these and only fetch for the row
 * the user actually opened.
 */
export function useJobOutput(jobId: string, active: boolean, enabled = true): string {
  const [output, setOutput] = useState("");

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/tasks/${encodeURIComponent(jobId)}/output`, { cache: "no-store" });
        const d = (await res.json()) as { output?: string };
        if (!cancelled) setOutput(typeof d.output === "string" ? d.output : "");
      } catch {
        /* keep the last output on a transient error */
      }
    };
    void load();
    const timer = active ? setInterval(load, 3000) : null;
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [jobId, active, enabled]);

  return output;
}

/** Transformer Lab returns this while a job is still launching, before the task
 *  has written anything — it is not a log, so don't render it as one. */
export function hasRealLog(output: string): boolean {
  return output.trim().length > 0 && !/no log files? found/i.test(output);
}

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

function Action({
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

/**
 * The log itself: the WHOLE thing (the decisive lines — a model id, a dtype
 * mismatch, a traceback — are usually far above the last few), with copy and a
 * full-screen view because a long traceback is unreadable in a small box.
 */
export function JobLogPanel({
  output,
  active,
  emptyLabel,
}: {
  output: string;
  active: boolean;
  /** Shown when there is no log yet — the reason differs per caller. */
  emptyLabel?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const paneRef = useRef<HTMLPreElement>(null);
  const expandedRef = useRef<HTMLPreElement>(null);

  const handleCopy = useCallback(async () => {
    if (await copyText(output)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  }, [output]);

  // Keep the log pinned to the bottom as it grows while running (both panes).
  useEffect(() => {
    if (!active) return;
    for (const el of [paneRef.current, expandedRef.current]) {
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [output, active, expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  if (!hasRealLog(output)) {
    return (
      <p className="flex items-center gap-1.5 rounded-md bg-surface-2 px-3 py-2 text-[11px] leading-4 text-ink-soft">
        {active ? <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden /> : null}
        {emptyLabel ?? (active ? "Menyiapkan… log muncul sebentar lagi." : "Belum ada log untuk job ini.")}
      </p>
    );
  }

  const lineCount = output.split("\n").length;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-ink-soft">Log lengkap · {lineCount} baris</span>
        <div className="flex items-center gap-1">
          <Action onClick={handleCopy} title="Salin seluruh log">
            {copied ? <Check className="size-3 text-primary" aria-hidden /> : <Copy className="size-3" aria-hidden />}
            {copied ? "Tersalin" : "Salin"}
          </Action>
          <Action onClick={() => setExpanded(true)} title="Perbesar (Esc untuk menutup)">
            <Maximize2 className="size-3" aria-hidden /> Perbesar
          </Action>
        </div>
      </div>
      <LogPane text={output} paneRef={paneRef} className="max-h-64" />

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
              <span className="text-[13px] font-medium text-ink">Log job · {lineCount} baris</span>
              <div className="flex items-center gap-1">
                <Action onClick={handleCopy} title="Salin seluruh log">
                  {copied ? <Check className="size-3 text-primary" aria-hidden /> : <Copy className="size-3" aria-hidden />}
                  {copied ? "Tersalin" : "Salin"}
                </Action>
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
  );
}
