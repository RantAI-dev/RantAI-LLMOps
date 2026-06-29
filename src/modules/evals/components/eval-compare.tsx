"use client";

import { GitCompareArrows, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { EvalJob, EvalModel, EvalOptions } from "@/lib/evals";
import { cn } from "@/lib/utils";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Pick the headline accuracy from a job's scores (prefer plain `acc`). */
function primaryScore(job: EvalJob): number | null {
  if (job.scores.length === 0) return null;
  const acc = job.scores.find((s) => s.type.toLowerCase() === "acc");
  return (acc ?? job.scores[0]).score;
}

function label(id: string | undefined, models: EvalModel[]): string {
  if (!id) return "—";
  const m = models.find((x) => x.id === id);
  return m?.name ?? id.split("/").pop() ?? id;
}

/** A model row with its score per benchmark, built from completed eval jobs. */
type Row = { id: string; name: string; fineTuned: boolean; scores: Record<string, number> };

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
        scores: {},
      };
      byModel.set(job.model, row);
    }
    if (!(job.benchmark in row.scores)) row.scores[job.benchmark] = score;
  }
  return { rows: [...byModel.values()], benchmarks: [...benchSet] };
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
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
  const baselineRow = rows.find((r) => r.id === baseline);

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

      {/* --- Results matrix --- */}
      {rows.length > 0 && benchmarks.length > 0 ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-primary">Scoreboard</h3>
            <label className="flex items-center gap-2 text-[12px] text-ink-soft">
              Baseline (Δ):
              <select
                className="h-8 rounded-md border border-input bg-background px-2 text-[13px]"
                value={baseline}
                onChange={(e) => setBaseline(e.target.value)}
              >
                <option value="">none</option>
                {rows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[12px] text-ink-soft">
                  <th className="py-2 pr-3 font-medium">Model</th>
                  {benchmarks.map((b) => (
                    <th key={b} className="px-3 py-2 text-right font-medium">
                      {b}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-medium text-ink">{row.name}</span>
                      {row.fineTuned ? (
                        <span className="ml-1.5 rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          FT
                        </span>
                      ) : null}
                    </td>
                    {benchmarks.map((b) => {
                      const v = row.scores[b];
                      if (v == null) {
                        return (
                          <td key={b} className="px-3 py-2 text-right text-ink-soft/50">
                            —
                          </td>
                        );
                      }
                      const best = Math.max(
                        ...rows.map((r) => r.scores[b]).filter((x): x is number => x != null)
                      );
                      const isBest = v === best;
                      const baseVal = baselineRow?.scores[b];
                      const delta =
                        baseVal != null && row.id !== baseline ? v - baseVal : null;
                      return (
                        <td key={b} className="px-3 py-2 text-right tabular-nums">
                          <span className={cn(isBest && "font-semibold text-primary")}>
                            {pct(v)}
                          </span>
                          {delta != null ? (
                            <span
                              className={cn(
                                "ml-1.5 text-[11px]",
                                delta > 0 ? "text-emerald-600" : delta < 0 ? "text-danger" : "text-ink-soft"
                              )}
                            >
                              {delta > 0 ? "+" : ""}
                              {(delta * 100).toFixed(1)}
                            </span>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-ink-soft">
            Skor = akurasi (acc). <span className="text-primary">Bold</span> = terbaik per benchmark.
            Δ = selisih vs baseline (hijau = lebih baik).
          </p>
        </div>
      ) : null}
    </div>
  );
}
