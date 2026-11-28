"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { InfoTip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { GwError } from "@/modules/duo/lib/gw";

// ---------- formatting (null-safe: the gateway leaves fields out when they do not apply) ----------

export const fmtMs = (ms: unknown) => {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "–";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  const m = Math.floor(ms / 60_000);
  return `${m} min ${Math.round((ms % 60_000) / 1000)} s`;
};
export const fmtPct = (x: unknown, digits = 0) =>
  typeof x === "number" && Number.isFinite(x) ? `${(x * 100).toFixed(digits)}%` : "–";
export const fmtNum = (x: unknown, digits = 0) =>
  typeof x === "number" && Number.isFinite(x) ? x.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "–";
export const fmtInt = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x).toLocaleString() : "–");
export const fmtBytes = (n: unknown) => {
  if (typeof n !== "number" || !Number.isFinite(n)) return "–";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
};
/** A timestamp (ms, seconds or ISO text) as "3 min ago" / a date. */
export function fmtAgo(t: unknown): string {
  let ms: number | null = null;
  if (typeof t === "number" && Number.isFinite(t)) ms = t < 1e12 ? t * 1000 : t;
  else if (typeof t === "string" && t) {
    const p = Date.parse(t);
    if (!Number.isNaN(p)) ms = p;
  }
  if (ms === null) return "–";
  const d = Date.now() - ms;
  if (d < 0) return new Date(ms).toLocaleString();
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} h ago`;
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)} d ago`;
  return new Date(ms).toLocaleDateString();
}
export const str = (v: unknown, fallback = "–") => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : fallback);
export const arr = <T = Record<string, unknown>,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
export const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

// ---------- building blocks ----------

/** A titled card. */
export function Panel({
  title,
  info,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  info?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-hairline bg-surface", className)}>
      {title || actions ? (
        <header className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2.5">
          {title ? <h2 className="text-sm font-semibold text-primary">{title}</h2> : null}
          {info ? <InfoTip label="About this">{info}</InfoTip> : null}
          {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/** A number with its label. */
export function Stat({ label, value, hint, tone }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0 rounded-md border border-hairline bg-background px-3 py-2">
      <p className="truncate text-xs text-ink-soft">{label}</p>
      <p className={cn("mt-0.5 truncate text-lg font-semibold tabular-nums", tone ? TONE_TEXT[tone] : "text-primary")}>{value}</p>
      {hint ? <p className="truncate text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4", className)}>{children}</div>;
}

/** Label / value rows. */
export function KV({ rows, className }: { rows: Array<[ReactNode, ReactNode] | null | false>; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1.5 text-sm", className)}>
      {rows.filter(Boolean).map((r, i) => {
        const [k, v] = r as [ReactNode, ReactNode];
        return (
          <div key={i} className="contents">
            <dt className="text-ink-soft">{k}</dt>
            <dd className="min-w-0 break-words text-foreground">{v}</dd>
          </div>
        );
      })}
    </dl>
  );
}

export type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "fast" | "slow";
const TONE_PILL: Record<Tone, string> = {
  neutral: "border-hairline bg-surface-2 text-ink-soft",
  good: "border-success-border bg-success-soft text-success",
  warn: "border-warning-border bg-warning-soft text-warning-strong",
  bad: "border-danger-border bg-danger-soft text-danger",
  info: "border-hairline bg-info-soft text-info-strong",
  fast: "border-hairline bg-info-soft text-info-strong",
  slow: "border-hairline bg-primary-soft text-primary",
};
const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-primary",
  good: "text-success",
  warn: "text-warning-strong",
  bad: "text-danger",
  info: "text-info-strong",
  fast: "text-info-strong",
  slow: "text-primary",
};

export function Pill({ tone = "neutral", children, title, className }: { tone?: Tone; children: ReactNode; title?: string; className?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-4", TONE_PILL[tone], className)}>
      {children}
    </span>
  );
}

/** A horizontal bar for a share (0..1). */
export function Meter({ value, tone = "info", label }: { value: number | null | undefined; tone?: Tone; label?: string }) {
  const v = typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const color = { neutral: "bg-ink-faint", good: "bg-success", warn: "bg-warning", bad: "bg-danger", info: "bg-info", fast: "bg-info", slow: "bg-primary" }[tone];
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={v} aria-label={label}>
      <div className={cn("h-full rounded-full", color)} style={{ width: `${v * 100}%` }} />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-ink-faint", className)} aria-hidden />;
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-6 text-sm text-ink-soft" role="status">
      <Spinner /> {label}
    </div>
  );
}

/** A small note (no data, not enabled). */
export function Note({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <div role={tone === "bad" ? "alert" : undefined} className={cn("rounded-md border px-3 py-2 text-sm", TONE_PILL[tone], className)}>
      {children}
    </div>
  );
}

/** The gateway error for a section: not configured (503), unreachable (502) or the gateway's own message. */
export function GwErrorState({ error, onRetry, what = "this page" }: { error: GwError; onRetry?: () => void; what?: string }) {
  if (error.status === 503)
    return (
      <ErrorState
        title="Semantic Duo is not configured"
        description={
          <>
            Set <code>DUO_GATEWAY_URL</code> and <code>DUO_GATEWAY_TOKEN</code> on the LLMOps frontend (see docs/RENCANA-DUO.md).
          </>
        }
      />
    );
  return <ErrorState title={`Could not load ${what}`} description={error.message} onRetry={onRetry} />;
}

/** A small inline note that a background refresh failed; what is already on screen is kept. */
export function StaleNote({ error, onRetry, className }: { error: { message: string }; onRetry?: () => void; className?: string }) {
  return (
    <p role="status" className={cn("flex flex-wrap items-center gap-2 text-xs text-danger", className)}>
      <span>Could not refresh: {error.message}. Showing what was loaded before.</span>
      {onRetry ? (
        <Button type="button" size="xs" variant="ghost" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </p>
  );
}

/** A button that asks once more before a destructive action ("Delete" → "Click again to delete"). */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = "Click again to confirm",
  disabled,
  size = "sm",
  variant = "destructive",
  className,
  title,
  ariaLabel,
}: {
  onConfirm: () => void | Promise<void>;
  children: ReactNode;
  confirmLabel?: string;
  disabled?: boolean;
  size?: "xs" | "sm" | "default";
  variant?: "destructive" | "outline" | "ghost";
  className?: string;
  title?: string;
  /** The accessible name before it is armed (once armed, the name is `confirmLabel`). */
  ariaLabel?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <Button
      type="button"
      size={size}
      variant={armed ? "destructive" : variant}
      disabled={disabled || busy}
      className={className}
      title={title}
      aria-label={armed ? undefined : ariaLabel}
      onClick={async () => {
        if (!armed) {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 4000);
          return;
        }
        if (timer.current) clearTimeout(timer.current);
        setArmed(false);
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Spinner className="size-3.5" /> : null}
      {armed ? confirmLabel : children}
    </Button>
  );
}

/** Segmented choice. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ id: T; label: ReactNode; hint?: string }>;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-md border border-hairline bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          title={o.hint}
          onClick={() => onChange(o.id)}
          className={cn(
            "rounded px-2.5 py-1 text-xs font-medium transition-colors",
            value === o.id ? "bg-background text-primary shadow-sm" : "text-ink-soft hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Pre-formatted text (evidence, code, JSON). */
export function CodeBlock({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <pre className={cn("max-h-80 overflow-auto rounded-md border border-hairline bg-surface-2 p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words", className)}>
      {children}
    </pre>
  );
}

/** A section's heading line inside a page. */
export function PageIntro({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold text-primary">{title}</h2>
        {children ? <p className="mt-0.5 max-w-3xl text-sm text-ink-soft">{children}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
