"use client";

import { AlertTriangle, GitCompareArrows, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { compareScores, formatPct, scoreInterval } from "@/lib/eval-stats";
import { benchmarkById } from "@/lib/benchmarks";
import type { EvalJob, EvalModel, EvalOptions, EvalScore } from "@/lib/evals";
import { VERDICT_STYLE } from "@/modules/evals/components/score-display";
import { cn } from "@/lib/utils";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Pick the headline accuracy from a job's scores (prefer plain `acc`). */
function primaryScore(job: EvalJob): EvalScore | null {
  if (job.scores.length === 0) return null;
  const acc = job.scores.find((s) => s.type.toLowerCase() === "acc");
  return acc ?? job.scores[0];
}

function label(id: string | undefined, models: EvalModel[]): string {
  if (!id) return "—";
  const m = models.find((x) => x.id === id);
  return m?.name ?? id.split("/").pop() ?? id;
}

/**
 * One model's result on one benchmark. Coverage rides along with the score
 * because comparing a 5% run against a 100% run is not a comparison, and the
 * scoreboard is exactly where that mistake gets made.
 */
type Cell = { score: EvalScore; coverage?: number; samples?: number };
type Row = { id: string; name: string; fineTuned: boolean; cells: Record<string, Cell> };

function buildMatrix(jobs: EvalJob[], models: EvalModel[]): { rows: Row[]; benchmarks: string[] } {
  const byModel = new Map<string, Row>();
  const benchSet = new Set<string>();
  // Jobs come newest-first → the first score seen for a (model, benchmark) wins.
  for (const job of jobs) {
    const score = primaryScore(job);
    if (score == null || !job.model || !job.benchmark) continue;
    benchSet.add(job.benchmark);
    let row = byModel.get(job.model);
    if (!row) {
      const m = models.find((x) => x.id === job.model);
      row = {
        id: job.model,
        name: label(job.model, models),
        fineTuned: m?.fineTuned ?? job.model.startsWith("TransformerLab/"),
        cells: {},
      };
      byModel.set(job.model, row);
    }
    if (!(job.benchmark in row.cells)) {
      row.cells[job.benchmark] = { score, coverage: job.coverage, samples: job.samples };
    }
  }
  return { rows: [...byModel.values()], benchmarks: [...benchSet] };
}

/**
 * One model's bar on one benchmark, with its error band, plus the verdict
 * against the baseline.
 *
 * The delta is deliberately not a bare number: the previous scoreboard printed
 * "+1.2" in green for a gap smaller than the measurement error, which is how a
 * re-run of the same model came to look like an improvement.
 */
function CompareRow({
  row,
  cell,
  baseline,
  chance,
  isBest,
}: {
  row: Row;
  cell: Cell;
  baseline: Cell | null;
  chance?: number;
  isBest: boolean;
}) {
  const interval = scoreInterval(cell.score.score, cell.score.stderr);
  const pos = (v: number) => `${Math.min(100, Math.max(0, v * 100))}%`;
  const cmp =
    baseline && baseline !== cell
      ? compareScores(
          cell.score.score,
          baseline.score.score,
          cell.score.stderr,
          baseline.score.stderr
        )
      : null;

  return (
    <div className="grid grid-cols-[minmax(90px,1.1fr)_1fr_auto] items-center gap-3 py-2">
      <div className="min-w-0">
        <span className={cn("truncate text-[13px]", isBest ? "font-semibold text-ink" : "text-ink")}>
          {row.name}
        </span>
        {row.fineTuned ? (
          <span className="ml-1.5 rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-medium text-primary">
            FT
          </span>
        ) : null}
        <span className="block text-[10.5px] tabular-nums text-ink-faint">
          {cell.coverage != null ? `${Math.round(cell.coverage * 100)}% soal` : "cakupan ?"}
          {cell.samples != null ? ` · n=${cell.samples}` : ""}
        </span>
      </div>

      <div className="relative h-2.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn("h-full rounded-full", isBest ? "bg-primary" : "bg-primary/60")}
          style={{ width: pos(cell.score.score) }}
        />
        {interval ? (
          <div
            className="absolute inset-y-0 bg-primary/25"
            style={{ left: pos(interval.low), width: pos(interval.high - interval.low) }}
          />
        ) : null}
        {chance != null ? (
          <div className="absolute inset-y-0 w-px bg-ink/40" style={{ left: pos(chance) }} aria-hidden />
        ) : null}
      </div>

      <div className="text-right">
        <span className="text-[13px] font-semibold tabular-nums text-ink">
          {formatPct(cell.score.score)}
        </span>
        {cell.score.stderr != null ? (
          <span className="ml-1 text-[10.5px] text-ink-soft">± {(cell.score.stderr * 100).toFixed(1)}</span>
        ) : null}
        {cmp ? (
          <span
            className={cn(
              "block text-[10.5px] tabular-nums",
              VERDICT_STYLE[cmp.verdict].className
            )}
            title={VERDICT_STYLE[cmp.verdict].label}
          >
            {cmp.verdict === "tie"
              ? "≈ setara"
              : cmp.verdict === "unknown"
                ? `${cmp.delta > 0 ? "+" : ""}${(cmp.delta * 100).toFixed(1)} (?)`
                : `${cmp.delta > 0 ? "+" : ""}${(cmp.delta * 100).toFixed(1)} pt`}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function EvalCompare({
  options,
  jobs,
  comparing,
  compareProgress,
  onCompare,
}: {
  options: EvalOptions;
  jobs: EvalJob[];
  comparing: boolean;
  compareProgress: { done: number; total: number } | null;
  onCompare: (
    models: Array<{ id: string; architecture?: string; fineTuned?: boolean }>,
    benchmark: string,
    limit: number
  ) => Promise<boolean>;
}) {
  const [benchmark, setBenchmark] = useState("arc_easy");
  const [picked, setPicked] = useState<string[]>([]);
  const [coverage, setCoverage] = useState(5);
  const [baseline, setBaseline] = useState<string>("");

  const { rows, benchmarks } = useMemo(() => buildMatrix(jobs, options.models), [jobs, options.models]);

  const toggle = (id: string) =>
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const canRun = picked.length >= 2 && !comparing;

  return (
    <div className="space-y-4">
      {/* --- Run a comparison --- */}
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-2">
          <GitCompareArrows className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold text-primary">Compare models</h2>
        </div>

        {options.models.length < 2 ? (
          <p className="rounded-md bg-surface-2 px-3 py-2 text-[13px] text-ink-soft">
            Butuh minimal 2 model non-GGUF buat dibandingin (mis. base + hasil fine-tune).
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-ink">Benchmark</span>
                <select
                  className={selectClass}
                  value={benchmark}
                  onChange={(e) => setBenchmark(e.target.value)}
                >
                  {options.benchmarks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-ink">
                  Coverage — {coverage}%
                </span>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={coverage}
                  onChange={(e) => setCoverage(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </label>
            </div>

            <div className="mt-3">
              <span className="mb-1.5 block text-[13px] font-medium text-ink">
                Models ({picked.length} dipilih)
              </span>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {options.models.map((m) => (
                  <label
                    key={m.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-[13px] text-ink hover:bg-surface-2"
                  >
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={picked.includes(m.id)}
                      onChange={() => toggle(m.id)}
                    />
                    <span className="truncate">{m.name}</span>
                    {m.fineTuned ? (
                      <span className="ml-auto rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        FT
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
            </div>

            {comparing && compareProgress ? (
              <div className="mt-3 flex items-center gap-2">
                <Progress
                  value={(compareProgress.done / Math.max(1, compareProgress.total)) * 100}
                  className="h-1.5 flex-1"
                />
                <span className="text-[12px] tabular-nums text-ink-soft">
                  {compareProgress.done}/{compareProgress.total} selesai
                </span>
              </div>
            ) : null}

            <div className="mt-4 flex items-center gap-3">
              <Button
                type="button"
                disabled={!canRun}
                onClick={() =>
                  onCompare(
                    picked.map((id) => {
                      const m = options.models.find((x) => x.id === id);
                      return { id, architecture: m?.architecture, fineTuned: m?.fineTuned };
                    }),
                    benchmark,
                    coverage / 100
                  )
                }
              >
                {comparing ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden /> Running…
                  </>
                ) : (
                  `Run on ${picked.length || "…"} models`
                )}
              </Button>
              <p className="text-[12px] text-ink-soft">
                Jalan <strong>satu per satu</strong> (eval baca model dari foundation pas run).
              </p>
            </div>
          </>
        )}
      </div>

      {/* --- Scoreboard: one panel per benchmark, models as bars --- */}
      {rows.length > 0 && benchmarks.length > 0 ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-primary">Scoreboard</h3>
            <label className="flex items-center gap-2 text-[12px] text-ink-soft">
              Bandingkan terhadap:
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-[13px]"
                value={baseline}
                onChange={(e) => setBaseline(e.target.value)}
              >
                <option value="">— tidak ada —</option>
                {rows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="space-y-4">
            {benchmarks.map((b) => {
              const bench = benchmarkById(b);
              const entries = rows
                .filter((r) => r.cells[b])
                .sort((x, y) => y.cells[b].score.score - x.cells[b].score.score);
              if (entries.length === 0) return null;
              const best = entries[0].cells[b].score.score;
              // Scores from different coverages are not on the same scale. Say so
              // rather than letting the bars imply they are.
              const coverages = new Set(entries.map((e) => e.cells[b].coverage));
              const mixedCoverage = coverages.size > 1;
              const partial = [...coverages].some((c) => c == null || c < 1);
              const baseCell = baseline ? (rows.find((r) => r.id === baseline)?.cells[b] ?? null) : null;

              return (
                <div key={b} className="rounded-lg border border-hairline-2 p-3">
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                    <h4 className="text-[13px] font-semibold text-ink">{bench?.name ?? b}</h4>
                    <span className="text-[11px] text-ink-faint">
                      {bench ? `${bench.description} · tebak acak ${Math.round(bench.chance * 100)}%` : b}
                    </span>
                  </div>

                  {mixedCoverage ? (
                    <p className="mb-2 flex items-start gap-1.5 rounded-md bg-danger-soft px-2.5 py-1.5 text-[11px] text-danger">
                      <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                      Cakupan soalnya berbeda antar model, jadi angka-angka ini{" "}
                      <strong>tidak sebanding</strong>. Jalankan ulang dengan cakupan yang sama.
                    </p>
                  ) : partial ? (
                    <p className="mb-2 rounded-md bg-warning-soft px-2.5 py-1.5 text-[11px] text-warning">
                      Belum seluruh benchmark dijalankan — selisih kecil di sini besar
                      kemungkinan cuma kebetulan.
                    </p>
                  ) : null}

                  <div className="divide-y divide-hairline-2">
                    {entries.map((r) => (
                      <CompareRow
                        key={r.id}
                        row={r}
                        cell={r.cells[b]}
                        baseline={baseCell}
                        chance={bench?.chance}
                        isBest={r.cells[b].score.score === best}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <p className="mt-3 text-[11px] leading-4 text-ink-soft">
            Batang penuh = akurasi (acc). Bagian yang lebih terang = rentang ketidakpastian;
            garis vertikal = skor kalau menebak acak. Selisih terhadap pembanding hanya
            ditulis sebagai angka kalau lebih besar daripada galat pengukuran — kalau tidak,
            tertulis <span className="text-ink">≈ setara</span>, dan{" "}
            <span className="text-ink-faint">(?)</span> berarti galatnya tidak diketahui
            sehingga belum bisa disimpulkan.
          </p>
        </div>
      ) : null}
    </div>
  );
}
