"use client";

import { AlertTriangle } from "lucide-react";

import { formatInterval, formatPct, scoreInterval, type Interval } from "@/lib/eval-stats";
import type { EvalScore } from "@/lib/evals";
import { cn } from "@/lib/utils";

/**
 * Shared score rendering for the Evals screen — the results list and the compare
 * scoreboard have to agree on what a number looks like and, more importantly, on
 * what it is allowed to claim.
 */

/**
 * A benchmark score as a bar plus its error bar.
 *
 * The bar is what makes a set of scores readable at a glance; the error band
 * drawn over it is what stops the reader treating a one-point gap as a result;
 * and the chance marker is what stops a two-choice benchmark being read like a
 * four-choice one — a model that has learnt nothing still scores 50% on BoolQ.
 */
export function ScoreBar({
  score,
  chance,
  className,
}: {
  score: EvalScore;
  chance?: number;
  className?: string;
}) {
  const interval = scoreInterval(score.score, score.stderr);
  const range = formatInterval(interval);
  const pos = (v: number) => `${Math.min(100, Math.max(0, v * 100))}%`;
  const atChance = chance != null && score.score <= chance;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-soft">
          {score.type}
        </span>
        <span className="text-sm font-semibold tabular-nums text-ink">
          {formatPct(score.score)}
          {score.stderr != null ? (
            <span className="ml-1 text-[11px] font-normal text-ink-soft">
              ± {(score.stderr * 100).toFixed(1)}
            </span>
          ) : null}
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn("h-full rounded-full", atChance ? "bg-danger" : "bg-primary")}
          style={{ width: pos(score.score) }}
        />
        {interval ? (
          // The plausible range, drawn over the fill so the reader sees how much
          // of the bar's tip is uncertainty rather than measurement.
          <div
            className="absolute inset-y-0 bg-primary/25"
            style={{
              left: pos(interval.low),
              width: pos(interval.high - interval.low),
            }}
          />
        ) : null}
        {chance != null ? (
          <div
            className="absolute inset-y-0 w-px bg-ink/40"
            style={{ left: pos(chance) }}
            aria-hidden
          />
        ) : null}
      </div>
      <p className="text-[11px] text-ink-faint">
        {range ? `Kemungkinan sebenarnya ${range}` : "Rentang ketidakpastian tidak tersedia"}
        {chance != null ? ` · tebak acak ${Math.round(chance * 100)}%` : ""}
      </p>
      {atChance ? (
        <p className="text-[11px] font-medium text-danger">
          Setara menebak — model tidak menunjukkan kemampuan di benchmark ini.
        </p>
      ) : null}
    </div>
  );
}

/**
 * How much of the benchmark actually ran.
 *
 * Loud below 100% on purpose: a 5% run and a full run render the same
 * percentage, and the only thing separating a headline number from a smoke test
 * is this badge.
 */
export function CoverageBadge({
  coverage,
  samples,
}: {
  coverage?: number;
  samples?: number;
}) {
  if (coverage == null) return null;
  const partial = coverage < 1;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium tabular-nums",
        partial ? "bg-warning-soft text-warning" : "bg-success-soft text-success"
      )}
      title={
        partial
          ? "Baru sebagian benchmark yang dijalankan — belum bisa dipakai sebagai skor resmi."
          : "Seluruh benchmark dijalankan."
      }
    >
      {partial ? <AlertTriangle className="size-3" aria-hidden /> : null}
      {Math.round(coverage * 100)}% soal
      {samples != null ? ` · n=${samples}` : ""}
    </span>
  );
}

/** Colour + wording for a comparison verdict, shared by every delta shown. */
export const VERDICT_STYLE: Record<
  "better" | "worse" | "tie" | "unknown",
  { className: string; label: string }
> = {
  better: { className: "text-success", label: "lebih baik" },
  worse: { className: "text-danger", label: "lebih buruk" },
  // The wording matters: this is "we cannot tell them apart", not "they are equal".
  tie: { className: "text-ink-soft", label: "selisih dalam batas galat" },
  unknown: { className: "text-ink-faint", label: "tidak bisa disimpulkan" },
};

export type { Interval };
