"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, MinusCircle } from "lucide-react";

import { benchmarkById } from "@/lib/benchmarks";
import { compareScores, formatPct } from "@/lib/eval-stats";
import type { EvalJob, EvalModel, EvalOptions, EvalScore } from "@/lib/evals";
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
}: {
  benchmark: string;
  base: EvalScore | null;
  ft: EvalScore | null;
}) {
  const bench = benchmarkById(benchmark);
  const name = bench?.name ?? benchmark;

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
    kept: { label: "dipertahankan", cls: "text-success" },
    gained: { label: "naik", cls: "text-success" },
    dropped: { label: "TURUN", cls: "text-danger" },
    unknown: { label: "belum bisa disimpulkan", cls: "text-ink-faint" },
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
        ) : (
          <span className="text-ink-faint">belum dieval</span>
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
          <span className="text-ink-faint">belum dieval</span>
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

export function RetentionView({ options, jobs }: { options: EvalOptions; jobs: EvalJob[] }) {
  // Only fine-tunes that know their base model can be paired.
  const fineTunes = useMemo(
    () => options.models.filter((m): m is EvalModel & { baseModel: string } => m.fineTuned && !!m.baseModel),
    [options.models]
  );
  const [picked, setPicked] = useState<string>("");
  const ft = fineTunes.find((f) => f.id === picked) ?? fineTunes[0];

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
        Belum ada model fine-tune yang bisa dibandingkan. Latih satu di menu Fine-tune dulu.
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
          <span className="mb-1 block text-[13px] font-medium text-ink">Model fine-tune</span>
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
        <p className="mt-2 text-[12px] text-ink-soft">
          Dibandingkan dengan model dasarnya: <span className="font-medium text-ink">{baseLabel}</span>. Turunnya
          skor benchmark umum = <strong>catastrophic forgetting</strong> (model lupa kemampuan dasar).
        </p>
      </div>

      {analysis && analysis.rows.length > 0 ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          {/* Overall verdict */}
          {analysis.pairedCount === 0 ? (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-warning-soft px-3 py-2 text-[12px] text-warning">
              <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden />
              Belum ada benchmark yang dijalankan pada <strong>keduanya</strong>. Jalankan benchmark yang sama di
              tab <strong>Single run</strong> untuk base ({baseLabel}) dan untuk fine-tune ini, lalu kembali ke sini.
            </div>
          ) : analysis.dropped.length > 0 ? (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
              <AlertTriangle className="mt-px size-4 shrink-0" aria-hidden />
              <span>
                <strong>Ada penurunan kemampuan dasar</strong> di{" "}
                {analysis.dropped.map((d) => benchmarkById(d.benchmark)?.name ?? d.benchmark).join(", ")}. Pertimbangkan
                menaikkan porsi data lama (baseline) pada campuran SFT.
              </span>
            </div>
          ) : (
            <div className="mb-3 flex items-start gap-2 rounded-lg bg-success-soft px-3 py-2 text-[13px] text-success">
              <CheckCircle2 className="mt-px size-4 shrink-0" aria-hidden />
              <span>
                <strong>Kemampuan dasar dipertahankan</strong> — tidak ada penurunan yang melebihi galat pengukuran
                pada {analysis.pairedCount} benchmark yang dibandingkan.
              </span>
            </div>
          )}

          {/* Header */}
          <div className="grid grid-cols-[minmax(90px,1.2fr)_1fr_1fr_auto] gap-3 border-b border-hairline pb-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
            <span>Benchmark</span>
            <span>Base</span>
            <span>Fine-tune</span>
            <span className="text-right">Retensi</span>
          </div>
          {analysis.rows.map((r) => (
            <Row key={r.benchmark} benchmark={r.benchmark} base={r.base} ft={r.ft} />
          ))}

          <p className="mt-3 flex items-center gap-1.5 text-[11px] leading-4 text-ink-faint">
            <MinusCircle className="size-3 shrink-0" aria-hidden />
            &quot;Dipertahankan&quot; = selisih dalam batas galat. &quot;TURUN&quot; = penurunan yang melebihi galat
            (nyata). Kolom Base butuh benchmark dijalankan juga pada model dasar.
          </p>
        </div>
      ) : (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[13px] text-ink-soft">
          Belum ada benchmark untuk model ini. Jalankan beberapa di tab Single run (untuk fine-tune INI dan model
          dasarnya), lalu retensinya muncul di sini.
        </p>
      )}
    </div>
  );
}
