"use client";

import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InfoTip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Pill, Spinner, type Tone } from "@/modules/duo/components/duo-ui";

// ---------- plain names for the gateway's own vocabulary ----------

export const MODE_NAME: Record<string, string> = { fixed: "Simple rule", calibrated: "Learned", budget: "Fixed share" };
export const MODE_HINT: Record<string, string> = {
  fixed: "Think longer when the quick answer sounds unsure, or when quick samples disagree with each other.",
  calibrated: "Think longer when the predicted gain in accuracy is worth the extra time.",
  budget: "Think longer for a fixed share of questions: the ones where it is most likely to help.",
};

export const CHECKER_NAME: Record<string, string> = {
  code_tests: "Code tests",
  json_schema: "Format check",
  judge: "Review",
  math_numeric: "Number match",
  math_symbolic: "Formula match",
  lean: "Proof check",
};
export const checkerName = (k: string) => CHECKER_NAME[k] ?? k;

export const ALERT_NAME: Record<string, string> = {
  fast_path_latency: "Quick answers are slow (slowest 5%)",
  error_rate: "Share of failed answers",
  escalation_rate: "Share sent to thorough (cost)",
  verifier_acceptance: "Share of checks that pass",
  calibration_drift: "Mistake prediction has drifted",
};

export const GATE_NAME: Record<string, string> = {
  G0: "Setup measured and model server chosen",
  G1: "First version accepted and fast enough",
  G2: "Auto as good as always thinking, in less time",
  G3: "First quick-model update trained, proven and reversible",
  G4: "Full test suite run and load tested",
  G5: "Security reviewed and deployment verified",
  G6: "Release: no worse than always thinking, tests green, sign-off",
};

const DOMAIN_NAME: Record<string, string> = {
  code: "Code",
  math: "Maths",
  structured: "Formats (JSON)",
  factual: "Facts",
  open: "Open questions",
  other: "Other",
  all: "All topics",
};
export const domainName = (d: unknown) => {
  const s = typeof d === "string" && d ? d : "other";
  return DOMAIN_NAME[s] ?? s.charAt(0).toUpperCase() + s.slice(1);
};

const TAG = /\s?\((?:see\s)?(?:FR|NFR|ER|TR|OR|SR|IF)-\d+[^)]*\)|\s?\((?:Prop\.|Thm|Theorem|Lemma|H\d|G\d|DKW)[^)]*\)/g;
/** The gateway's text in reader's words: requirement ids out, "System 1" as the quick model, and so on. */
export function plain(t: unknown): string {
  return String(t ?? "")
    .replace(TAG, "")
    .replace(/\b(?:FR|NFR|ER|TR|OR|SR)-\d+:\s/g, "")
    .replace(/\bexact verifiers?\b/g, (m) => (m.endsWith("s") ? "exact checks" : "exact check"))
    .replace(/\bverifiers?\b/g, (m) => (m.endsWith("s") ? "checks" : "check"))
    .replace(/\bSystem 1 drafts?\b/g, (m) => (m.endsWith("s") ? "quick drafts" : "quick draft"))
    .replace(/\bSystem 2 answers?\b/g, (m) => (m.endsWith("s") ? "thorough answers" : "thorough answer"))
    .replace(/\be1_hat\b/g, "predicted risk")
    .replace(/no fitted calibration \(uncalibrated prior\)/g, "nothing learned yet")
    .replace(/\bdeliberation\b/g, "thinking longer")
    .replace(/\bescalated to\b/g, "sent to")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** pass / fail / pending as a coloured pill, in plain words. */
export const TRI: Record<string, { tone: Tone; label: string }> = {
  pass: { tone: "good", label: "Met" },
  fail: { tone: "bad", label: "Not met" },
  pending: { tone: "warn", label: "Not yet known" },
};
export function TriPill({ status }: { status: unknown }) {
  const s = TRI[String(status)] ?? { tone: "neutral" as Tone, label: String(status ?? "–") };
  return <Pill tone={s.tone}>{s.label}</Pill>;
}

/** A source of a setting: measured from experiments, or the default value. */
export function SourcePill({ source }: { source: unknown }) {
  return source === "measured" ? <Pill tone="good">measured</Pill> : <Pill>default</Pill>;
}

/** A column heading with its explanation in a tooltip (the technical name goes there too). */
export function Th({ children, tip, className }: { children: ReactNode; tip?: ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn("whitespace-nowrap px-3 py-1.5 text-left font-medium", className)}>
      <span className="inline-flex items-center gap-1">
        {children}
        {tip ? <InfoTip label={`About ${typeof children === "string" ? children : "this column"}`}>{tip}</InfoTip> : null}
      </span>
    </th>
  );
}
export const tableCls = "w-full text-[12px]";
export const theadCls = "bg-surface-2 text-ink-soft";
export const trCls = "border-t border-hairline";
export const tdCls = "px-3 py-1.5 align-top";

/** Horizontal scroll wrapper for a table. */
export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("overflow-x-auto rounded-md border border-hairline", className)}>{children}</div>;
}

/** A panel that folds open: the summary line stays visible, details open on demand. */
export function Fold({
  title,
  summary,
  children,
  defaultOpen = false,
  actions,
}: {
  title: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-lg border border-hairline bg-surface">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex min-w-0 items-center gap-1.5 text-left text-sm font-semibold text-primary"
        >
          <ChevronDown className={cn("size-4 shrink-0 transition-transform", !open && "-rotate-90")} aria-hidden />
          {title}
        </button>
        {summary ? <span className="text-xs text-ink-soft">{summary}</span> : null}
        {actions ? <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {open ? <div className="border-t border-hairline p-4">{children}</div> : null}
    </section>
  );
}

/** "Are you sure?" for actions that change how the service behaves for everyone. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  destructive = false,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-primary">{title}</DialogTitle>
          <DialogDescription render={<div />}>{children}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant={destructive ? "destructive" : "default"} onClick={onConfirm} disabled={busy}>
            {busy ? <Spinner className="size-3.5" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- charts (plain SVG, theme tokens so they read in light and dark) ----------

/** Predicted chance the quick answer is wrong (x) against how often it was wrong (y); dot size is the count. */
export function ReliabilityChart({ points }: { points: Array<[number, number, number]> }) {
  const W = 300;
  const H = 240;
  const pad = 36;
  const sx = (v: number) => pad + v * (W - pad - 10);
  const sy = (v: number) => H - pad - v * (H - pad - 10);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Predicted against observed mistakes of the quick answer" className="w-full max-w-[320px]">
      <rect x={pad} y={10} width={W - pad - 10} height={H - pad - 10} className="fill-none stroke-hairline" />
      <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} className="stroke-ink-faint" strokeDasharray="4 3" />
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <text x={sx(t)} y={H - pad + 14} textAnchor="middle" className="fill-ink-soft text-[10px]">
            {Math.round(t * 100)}%
          </text>
          <text x={pad - 5} y={sy(t) + 3} textAnchor="end" className="fill-ink-soft text-[10px]">
            {Math.round(t * 100)}%
          </text>
        </g>
      ))}
      {points.map(([p, o, n], i) => (
        <circle key={i} cx={sx(clamp01(p))} cy={sy(clamp01(o))} r={3 + Math.min(8, Math.sqrt(Math.max(0, n)))} className="fill-primary" fillOpacity={0.65}>
          <title>{`Predicted ${Math.round(p * 100)}%, observed ${Math.round(o * 100)}% (${n} answers)`}</title>
        </circle>
      ))}
      <text x={(W + pad) / 2} y={H - 4} textAnchor="middle" className="fill-ink-soft text-[10px]">
        Predicted chance the quick answer is wrong
      </text>
      <text x={10} y={H / 2} textAnchor="middle" transform={`rotate(-90 10 ${H / 2})`} className="fill-ink-soft text-[10px]">
        How often it was wrong
      </text>
    </svg>
  );
}
const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** A CUSUM chart: the upward and downward sums against the alarm line. */
export function CusumSpark({ hi, lo, h, label }: { hi: number[]; lo: number[]; h: number; label: string }) {
  const W = 180;
  const H = 40;
  const max = Math.max(h, ...hi, ...lo, 1e-9);
  const y = (v: number) => H - 2 - (Math.max(0, v) / max) * (H - 4);
  const line = (xs: number[]) => xs.map((v, i) => `${(i / Math.max(1, xs.length - 1)) * W},${y(v)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label} className="max-w-full">
      <line x1={0} x2={W} y1={y(h)} y2={y(h)} className="stroke-danger" strokeDasharray="3 2" strokeWidth={1} />
      {hi.length ? <polyline points={line(hi)} fill="none" className="stroke-primary" strokeWidth={1.5} /> : null}
      {lo.length ? <polyline points={line(lo)} fill="none" className="stroke-info" strokeWidth={1.5} /> : null}
    </svg>
  );
}

export const nums = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === "number" && Number.isFinite(x)) : []);
export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
