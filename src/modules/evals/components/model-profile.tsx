"use client";

import { useMemo } from "react";

import { BENCHMARKS } from "@/lib/benchmarks";
import { formatInterval, scoreInterval } from "@/lib/eval-stats";
import type { EvalJob } from "@/lib/evals";
import { cn } from "@/lib/utils";

/**
 * Every benchmark a model has run, on one chart.
 *
 * The results list shows one card per run, so a model's overall shape — strong
 * at science, weak at coreference — is spread across separate cards and never
 * actually visible. This is the view someone means when they ask what a model
 * scores.
 *
 * Bars are drawn against each benchmark's own chance level rather than zero.
 * WinoGrande is two-choice and ARC is four-choice, so 74% and 79% are not the
 * comparable numbers they look like; scaling from chance is what makes a row of
 * bars mean the same thing all the way across.
 */

type Entry = {
  benchmark: string;
  name: string;
  score: number;
  stderr?: number;
  chance: number;
  coverage?: number;
};

function buildProfile(jobs: EvalJob[], model: string): Entry[] {
  const seen = new Map<string, Entry>();
  for (const job of jobs) {
    if (job.model !== model || job.status !== "COMPLETE" || !job.benchmark) continue;
    // Jobs arrive newest-first, so the first hit per benchmark is the latest run.
    if (seen.has(job.benchmark)) continue;
    const bench = BENCHMARKS.find((b) => b.id === job.benchmark);
    const acc = job.scores.find((s) => s.type.toLowerCase() === "acc") ?? job.scores[0];
    if (!acc || !bench) continue;
    seen.set(job.benchmark, {
      benchmark: job.benchmark,
      name: bench.name,
      score: acc.score,
      stderr: acc.stderr,
      chance: bench.chance,
      coverage: job.coverage,
    });
  }
  // Keep the catalogue's order so the chart does not reshuffle between renders.
  return BENCHMARKS.map((b) => seen.get(b.id)).filter((e): e is Entry => e != null);
}

/** Where a score sits between chance and perfect, 0..1. */
function aboveChance(score: number, chance: number): number {
  return Math.max(0, Math.min(1, (score - chance) / (1 - chance)));
}

export function ModelProfile({ jobs, models }: { jobs: EvalJob[]; models: string[] }) {
  const profiles = useMemo(
    () => models.map((m) => ({ model: m, entries: buildProfile(jobs, m) })).filter((p) => p.entries.length > 0),
    [jobs, models]
  );

  if (profiles.length === 0) return null;

  return (
    <div className="space-y-3">
      {profiles.map(({ model, entries }) => {
        const done = entries.length;
        return (
          <div key={model} className="rounded-xl border border-border bg-surface p-4">
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-primary">{model.split("/").pop()}</h3>
              <span className="text-[11px] text-ink-soft">
                {done} dari {BENCHMARKS.length} benchmark sudah dijalankan
              </span>
            </div>
            <p className="mb-3 text-[11px] leading-4 text-ink-faint">
              Panjang batang = seberapa jauh di atas skor menebak acak, karena tiap benchmark
              jumlah pilihannya berbeda. Angka di kanan tetap akurasi apa adanya.
            </p>

            <div className="space-y-2.5">
              {entries.map((e) => {
                const lift = aboveChance(e.score, e.chance);
                const interval = scoreInterval(e.score, e.stderr);
                const range = formatInterval(interval);
                return (
                  <div key={e.benchmark} className="grid grid-cols-[minmax(88px,1fr)_2fr_auto] items-center gap-3">
                    <span className="truncate text-[12px] text-ink" title={e.name}>
                      {e.name}
                    </span>
                    <div className="relative h-2.5 overflow-hidden rounded-full bg-surface-2">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          lift <= 0 ? "bg-danger" : lift < 0.3 ? "bg-warning" : "bg-primary"
                        )}
                        style={{ width: `${lift * 100}%` }}
                      />
                    </div>
                    <span
                      className="w-24 text-right text-[12px] font-semibold tabular-nums text-ink"
                      title={
                        range
                          ? `Kemungkinan sebenarnya ${range} · menebak acak ${Math.round(e.chance * 100)}%`
                          : `Menebak acak ${Math.round(e.chance * 100)}%`
                      }
                    >
                      {(e.score * 100).toFixed(1)}%
                      <span className="ml-1 text-[10px] font-normal text-ink-faint">
                        /{Math.round(e.chance * 100)}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>

            {entries.some((e) => e.coverage != null && e.coverage < 1) ? (
              <p className="mt-3 rounded-md bg-warning-soft px-2.5 py-1.5 text-[11px] text-warning">
                Sebagian benchmark di sini belum dijalankan penuh, jadi bentuk profilnya masih
                bisa berubah.
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
