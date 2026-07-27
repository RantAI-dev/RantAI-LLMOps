"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Play } from "lucide-react";

import { benchmarkById } from "@/lib/benchmarks";
import { InfoTip } from "@/components/ui/tooltip";
import { compareScores, formatPct } from "@/lib/eval-stats";
import type { EvalJob, EvalModel, EvalOptions, EvalScore } from "@/lib/evals";
import { isEvalActive } from "@/modules/evals/hooks/use-evals";
import { cn } from "@/lib/utils";

/**
 * Retention (catastrophic-forgetting) view.
 *
 * A fine-tune should keep the base model's general ability (the meeting's 70%
 * new / 30% base-knowledge mix aims exactly at this). This pairs a fine-tune
 * with the model it was trained from and, per academic benchmark, shows base
 * vs fine-tune — flagging any drop LARGER than the measurement error as a real
 * loss of capability, and calling the rest "kept".
 *
 * It reads the benchmark eval jobs you already ran; it does not run anything.
 */

/** Newest COMPLETE benchmark score for one (model, benchmark). Jobs are newest-first. */
function findScore(jobs: EvalJob[], model: string, benchmark: string): EvalScore | null {
  for (const job of jobs) {
    if (job.model !== model || job.benchmark !== benchmark || job.status !== "COMPLETE") continue;
    const acc = job.scores.find((s) => s.type.toLowerCase() === "acc") ?? job.scores[0];
    if (acc) return acc;
  }
  return null;
}

type Verdict = "kept" | "dropped" | "gained" | "unknown";

function Row({
  benchmark,
  base,
  ft,
  baseActive,
  running,
  submitting,
  onRunBase,
}: {
  benchmark: string;
  base: EvalScore | null;
  ft: EvalScore | null;
  /** A base eval on this benchmark is queued/running. */
  baseActive: boolean;
  /** This row's "run base" click is in flight. */
  running: boolean;
  /** Some eval is being submitted (shared submit state) — disable to avoid double-launch. */
  submitting: boolean;
  onRunBase: (benchmark: string) => void;
}) {
  const bench = benchmarkById(benchmark);
  const name = bench?.name ?? benchmark;
  // Offer to run the base only when there's a fine-tune score to compare against
  // but the base was never measured on this benchmark — exactly the gap that
  // otherwise forces a manual trip to Single run.
  const canRunBase = !!ft && !base;
  const basePending = running || baseActive;

  let verdict: Verdict = "unknown";
  let delta: number | null = null;
  if (base && ft) {
    const cmp = compareScores(ft.score, base.score, ft.stderr, base.stderr);
    delta = cmp.delta;
    verdict =
      cmp.verdict === "worse"
        ? "dropped"
        : cmp.verdict === "better"
          ? "gained"
          : cmp.verdict === "tie"
            ? "kept"
            : "unknown";
  }

  const style: Record<Verdict, { label: string; cls: string }> = {
    kept: { label: "kept", cls: "text-success" },
    gained: { label: "gained", cls: "text-success" },
    dropped: { label: "DROPPED", cls: "text-danger" },
    unknown: { label: "inconclusive", cls: "text-ink-faint" },
  };

  return (
    <div className="grid grid-cols-[minmax(90px,1.2fr)_1fr_1fr_auto] items-center gap-3 border-b border-hairline-2 py-2.5 last:border-0 text-[13px]">
      <span className="truncate text-ink" title={name}>
        {name}
      </span>
      {/* base */}
      <span className="tabular-nums text-ink-soft">
        {base ? (
          <>
            {formatPct(base.score)}
            {base.stderr != null ? <span className="text-ink-faint"> ±{(base.stderr * 100).toFixed(1)}</span> : null}
          </>
        ) : basePending ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-ink-soft">
            <Loader2 className="size-3 animate-spin" aria-hidden />
            running…
          </span>
        ) : canRunBase ? (
          <button
            type="button"
            onClick={() => onRunBase(benchmark)}
            disabled={submitting}
            className="inline-flex items-center gap-1 rounded border border-hairline-2 bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary-soft disabled:opacity-60"
            title="Run this benchmark on the base model (coverage matched to the fine-tune)"
          >
            <Play className="size-2.5" aria-hidden />
            Run base
          </button>
        ) : (
          <span className="text-ink-faint">not evaluated</span>
        )}
      </span>
      {/* fine-tune */}
      <span className="tabular-nums text-ink">
        {ft ? (
          <>
            {formatPct(ft.score)}
            {ft.stderr != null ? <span className="text-ink-faint"> ±{(ft.stderr * 100).toFixed(1)}</span> : null}
          </>
        ) : (
          <span className="text-ink-faint">not evaluated</span>
        )}
      </span>
      {/* verdict */}
      <span className={cn("text-right text-[11px] font-medium tabular-nums", style[verdict].cls)}>
        {base && ft ? (
          <>
            {delta != null && verdict !== "kept" ? `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(1)} · ` : ""}
            {style[verdict].label}
          </>
        ) : (
          <span className="text-ink-faint">—</span>
        )}
      </span>
    </div>
  );
}

export function RetentionView({
  options,
  jobs,
  onRunBase,
  submitting,
}: {
  options: EvalOptions;
  jobs: EvalJob[];
  /** Reuses the Single-run submit path — launches a base-model benchmark. */
  onRunBase: (body: {
    model: string;
    benchmark: string;
    limit: number;
    fineTuned?: boolean;
  }) => Promise<boolean>;
  submitting: boolean;
}) {
  // Only fine-tunes that know their base model can be paired.
  const fineTunes = useMemo(
    () => options.models.filter((m): m is EvalModel & { baseModel: string } => m.fineTuned && !!m.baseModel),
    [options.models]
  );
  const [picked, setPicked] = useState<string>("");
  const ft = fineTunes.find((f) => f.id === picked) ?? fineTunes[0];

  // One-click "evaluate the base on this benchmark", so the Retention view can
  // fill its own Base column instead of sending the user to Single run. Coverage
  // is matched to the fine-tune's run on that benchmark — comparing a 10% base to
  // a 100% fine-tune would read the sampling gap as a capability gap.
  const [runningBench, setRunningBench] = useState<string | null>(null);
  const runBase = async (benchmark: string) => {
    if (!ft) return;
    setRunningBench(benchmark);
    try {
      const ftJob = jobs.find(
        (j) => j.model === ft.name && j.benchmark === benchmark && j.status === "COMPLETE"
      );
      const limit = ftJob?.coverage ?? 0.1;
      await onRunBase({ model: ft.baseModel, benchmark, limit, fineTuned: false });
    } finally {
      setRunningBench(null);
    }
  };
  const isBaseActive = (benchmark: string) =>
    !!ft && jobs.some((j) => j.model === ft.baseModel && j.benchmark === benchmark && isEvalActive(j.status));

  const analysis = useMemo(() => {
    if (!ft) return null;
    // Benchmarks either model was measured on — union, so gaps are visible.
    const benches = new Set<string>();
    for (const j of jobs) {
      if (j.status !== "COMPLETE" || !j.benchmark) continue;
      if (j.model === ft.name || j.model === ft.baseModel) benches.add(j.benchmark);
    }
    const rows = [...benches].map((b) => ({
      benchmark: b,
      base: findScore(jobs, ft.baseModel, b),
      ft: findScore(jobs, ft.name, b),
    }));
    const paired = rows.filter((r) => r.base && r.ft);
    const dropped = paired.filter((r) => {
      const cmp = compareScores(r.ft!.score, r.base!.score, r.ft!.stderr, r.base!.stderr);
      return cmp.verdict === "worse";
    });
    return { rows, pairedCount: paired.length, dropped };
  }, [ft, jobs]);

  if (fineTunes.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[13px] text-ink-soft">
        No fine-tuned models to compare yet. Train one in the Fine-tune menu first.
      </p>
    );
  }

  const baseLabel =
    options.models.find((m) => m.id === ft?.baseModel || m.name === ft?.baseModel)?.name ??
    ft?.baseModel.split("/").pop() ??
    "—";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-ink">
            Fine-tune model
            <InfoTip label="About retention">
              Compared against its base model:{" "}
              <span className="font-medium text-ink">{baseLabel}</span>. A drop in general-benchmark
              scores = <strong>catastrophic forgetting</strong> (the model has lost base capability).
            </InfoTip>
          </span>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={ft?.id ?? ""}
            onChange={(e) => setPicked(e.target.value)}
          >
            {fineTunes.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {analysis && analysis.rows.length > 0 ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          {/* Overall verdict */}
          {analysis.pairedCount === 0 ? (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-[12px] text-warning">
              <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden />
              No benchmark has been run on <strong>both</strong> yet. For each benchmark below that already
              has a fine-tune score, click <strong>Run base</strong> in the Base column — it automatically
              evaluates the base model ({baseLabel}) on the same benchmark.
            </div>
          ) : analysis.dropped.length > 0 ? (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
              <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden />
              <span>
                <strong>Base capability dropped</strong> on{" "}
                {analysis.dropped.map((d) => benchmarkById(d.benchmark)?.name ?? d.benchmark).join(", ")}. Consider
                raising the share of old (baseline) data in the SFT mix.
              </span>
            </div>
          ) : (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-success-soft px-3 py-2 text-[13px] text-success">
              <CheckCircle2 className="mt-px size-4 shrink-0" aria-hidden />
              <span>
                <strong>Base capability retained</strong> — no drop exceeding the measurement error across
                the {analysis.pairedCount} benchmarks compared.
              </span>
            </div>
          )}

          {/* Header */}
          <div className="grid grid-cols-[minmax(90px,1.2fr)_1fr_1fr_auto] gap-3 border-b border-hairline pb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            <span>Benchmark</span>
            <span>Base</span>
            <span>Fine-tune</span>
            <span className="flex items-center justify-end gap-1">
              Retention
              <InfoTip label="How to read retention">
                &quot;Kept&quot; = the difference is within the margin of error. &quot;DROPPED&quot; = a
                drop exceeding the error (real). An empty Base can be filled directly with the{" "}
                <strong>Run base</strong> button (coverage is matched to the fine-tune automatically).
              </InfoTip>
            </span>
          </div>
          {analysis.rows.map((r) => (
            <Row
              key={r.benchmark}
              benchmark={r.benchmark}
              base={r.base}
              ft={r.ft}
              baseActive={isBaseActive(r.benchmark)}
              running={runningBench === r.benchmark}
              submitting={submitting}
              onRunBase={runBase}
            />
          ))}

        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[13px] text-ink-soft">
          No benchmarks for this model yet. Run some in the Single run tab (for THIS fine-tune and its
          base model), then its retention shows up here.
        </p>
      )}
    </div>
  );
}
