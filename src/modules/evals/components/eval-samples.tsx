"use client";

import { Check, ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { EvalSample } from "@/lib/evals";
import { cn } from "@/lib/utils";

/**
 * The questions behind the score.
 *
 * An accuracy says a model is wrong a fifth of the time; it cannot say which
 * fifth. These rows can, and they are the only part of a benchmark result that
 * suggests what to do next — which is why the grounding tab's failure list gets
 * read and a bare percentage does not.
 */

type Filter = "wrong" | "right" | "all";

function useSamples(jobId: string, enabled: boolean) {
  const [samples, setSamples] = useState<EvalSample[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || samples || error) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/evals/jobs/${encodeURIComponent(jobId)}/samples`);
        const data = (await res.json()) as { samples?: EvalSample[]; error?: string };
        if (!alive) return;
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setSamples(data.samples ?? []);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Gagal memuat rincian");
      }
    })();
    return () => {
      alive = false;
    };
  }, [jobId, enabled, samples, error]);

  return { samples, error };
}

function Row({ sample }: { sample: EvalSample }) {
  return (
    <div className="flex gap-2 border-b border-hairline-2 py-2 last:border-0">
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
          sample.correct ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
        )}
        aria-label={sample.correct ? "benar" : "salah"}
      >
        {sample.correct ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] leading-4 text-ink">{sample.question || "(soal kosong)"}</p>
        <p className="mt-1 text-[11px] leading-4 text-ink-soft">
          Jawaban model: <span className="text-ink">{sample.answer || "—"}</span>
          {!sample.correct ? (
            <>
              {" · "}Seharusnya: <span className="text-success">{sample.expected || "—"}</span>
            </>
          ) : null}
        </p>
      </div>
    </div>
  );
}

const PAGE = 25;

export function EvalSamples({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>("wrong");
  const [limit, setLimit] = useState(PAGE);
  const { samples, error } = useSamples(jobId, open);

  const right = samples?.filter((s) => s.correct).length ?? 0;
  const wrong = (samples?.length ?? 0) - right;
  const shown =
    samples?.filter((s) => (filter === "all" ? true : filter === "right" ? s.correct : !s.correct)) ??
    [];

  return (
    <div className="mt-2 border-t border-hairline-2 pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[12px] font-medium text-ink-soft hover:text-ink"
      >
        {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
        Rincian per soal
      </button>

      {open ? (
        <div className="mt-2">
          {error ? (
            <p className="rounded-md bg-danger-soft px-2.5 py-1.5 text-[11px] text-danger">{error}</p>
          ) : !samples ? (
            <p className="flex items-center gap-1.5 text-[12px] text-ink-soft">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Memuat rincian…
            </p>
          ) : samples.length === 0 ? (
            <p className="text-[12px] text-ink-soft">
              Job ini tidak menyimpan rincian per soal. Hanya run yang dijalankan setelah
              pembaruan terakhir yang menyimpannya.
            </p>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-3">
                <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full bg-success"
                    style={{ width: `${(right / samples.length) * 100}%` }}
                  />
                  <div className="h-full flex-1 bg-danger" />
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-ink-soft">
                  <span className="text-success">{right} benar</span> ·{" "}
                  <span className="text-danger">{wrong} salah</span>
                </span>
              </div>

              <div className="mb-2 flex gap-1">
                {(
                  [
                    ["wrong", `Salah (${wrong})`],
                    ["right", `Benar (${right})`],
                    ["all", `Semua (${samples.length})`],
                  ] as const
                ).map(([id, lbl]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => {
                      setFilter(id);
                      setLimit(PAGE);
                    }}
                    className={cn(
                      "rounded-md px-2 py-1 text-[11px] font-medium transition",
                      filter === id
                        ? "bg-primary-soft text-primary"
                        : "text-ink-soft hover:bg-surface-2 hover:text-ink"
                    )}
                  >
                    {lbl}
                  </button>
                ))}
              </div>

              <div className="max-h-96 overflow-y-auto rounded-lg border border-hairline-2 px-3">
                {shown.length === 0 ? (
                  <p className="py-3 text-[12px] text-ink-soft">Tidak ada soal di kategori ini.</p>
                ) : (
                  shown.slice(0, limit).map((s, i) => <Row key={i} sample={s} />)
                )}
              </div>

              {shown.length > limit ? (
                <button
                  type="button"
                  onClick={() => setLimit((n) => n + PAGE)}
                  className="mt-2 text-[11px] font-medium text-primary hover:underline"
                >
                  Tampilkan {Math.min(PAGE, shown.length - limit)} lagi ({limit} dari {shown.length})
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
