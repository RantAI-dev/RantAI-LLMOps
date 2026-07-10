"use client";

import { GitCompare, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { parseLoss } from "@/modules/finetune/lib/parse-loss";
import { cn } from "@/lib/utils";

type Run = {
  id: string;
  template: string;
  experimentId?: string;
  model?: string;
  dataset?: string;
  status: string;
  epochs?: number;
  batchSize?: number;
  learningRate?: number;
  maxSteps?: number;
  loraR?: number;
  loraAlpha?: number;
  startTime?: string;
  endTime?: string;
};

// Distinct line colors for up to 4 overlaid runs (the theme's chart palette).
const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];
const MAX_SELECT = 4;

const short = (id?: string) => (id ? id.split("/").pop() : "—");

function durationOf(start?: string, end?: string): string {
  const s = start ? Date.parse(start.replace(" ", "T")) : NaN;
  const e = end ? Date.parse(end.replace(" ", "T")) : NaN;
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return "—";
  const sec = Math.round((e - s) / 1000);
  return sec >= 60 ? `${Math.floor(sec / 60)}m ${sec % 60}s` : `${sec}s`;
}

/** Overlaid loss curves — each run normalized to full width so trends align by
 *  training progress (0–100%) regardless of step count. */
function LossChart({ series }: { series: Array<{ color: string; loss: number[] }> }) {
  const withData = series.filter((s) => s.loss.length >= 2);
  if (!withData.length) {
    return <p className="py-8 text-center text-[12px] text-ink-soft">Belum ada data loss buat run terpilih.</p>;
  }
  const all = withData.flatMap((s) => s.loss);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const w = 600;
  const h = 160;
  const pad = 6;
  return (
    <div className="rounded-md border border-hairline-2 bg-background p-2">
      <div className="mb-1 flex justify-between text-[10px] tabular-nums text-ink-soft">
        <span>{max.toFixed(2)}</span>
        <span>loss ↓ (progress 0→100%)</span>
        <span>{min.toFixed(2)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-40 w-full">
        {withData.map((s, i) => {
          const pts = s.loss
            .map((v, j) => {
              const x = pad + (j / (s.loss.length - 1)) * (w - 2 * pad);
              const y = pad + (1 - (v - min) / span) * (h - 2 * pad);
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            })
            .join(" ");
          return (
            <polyline
              key={i}
              points={pts}
              fill="none"
              stroke={s.color}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>
    </div>
  );
}

export function CompareRuns() {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [lossById, setLossById] = useState<Record<string, number[]>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tasks/list", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ jobs?: Run[] }>)
      .then((d) => {
        if (cancelled) return;
        const train = (d.jobs ?? []).filter((j) => String(j.status).toUpperCase() === "COMPLETE");
        setRuns(train);
      })
      .catch(() => {
        if (!cancelled) setRuns([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(run: Run) {
    const isSelected = selected.includes(run.id);
    if (!isSelected && selected.length >= MAX_SELECT) return; // at cap — ignore
    setSelected((prev) =>
      prev.includes(run.id) ? prev.filter((id) => id !== run.id) : [...prev, run.id]
    );
    // Lazily fetch + cache this run's loss curve. The side effect stays OUT of the
    // state updater (updaters must be pure — React may invoke them twice).
    if (!isSelected && !lossById[run.id]) {
      const qs = run.experimentId ? `?experimentId=${encodeURIComponent(run.experimentId)}` : "";
      fetch(`/api/tasks/${encodeURIComponent(run.id)}/output${qs}`, { cache: "no-store" })
        .then((r) => r.json() as Promise<{ output?: string }>)
        .then((d) => setLossById((m) => ({ ...m, [run.id]: parseLoss(d.output ?? "") })))
        .catch(() => setLossById((m) => ({ ...m, [run.id]: [] })));
    }
  }

  const chosen = useMemo(
    () =>
      selected
        .map((id, i) => ({ run: runs?.find((r) => r.id === id), color: COLORS[i] }))
        .filter((c): c is { run: Run; color: string } => Boolean(c.run)),
    [selected, runs]
  );

  if (runs === null) {
    return (
      <p className="flex items-center gap-2 rounded-xl border border-border bg-surface p-4 text-[13px] text-ink-soft">
        <Loader2 className="size-4 animate-spin" /> Memuat run…
      </p>
    );
  }
  if (runs.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[13px] text-ink-soft">
        Belum ada training run yang selesai. Jalankan beberapa fine-tune dulu, lalu bandingkan di sini.
      </p>
    );
  }

  const rows: Array<{ label: string; get: (r: Run) => string }> = [
    { label: "Base model", get: (r) => short(r.model) ?? "—" },
    { label: "Dataset", get: (r) => short(r.dataset) ?? "—" },
    { label: "Epochs", get: (r) => String(r.epochs ?? "—") },
    { label: "Max steps", get: (r) => String(r.maxSteps ?? "—") },
    { label: "LoRA rank", get: (r) => String(r.loraR ?? "—") },
    { label: "LoRA alpha", get: (r) => String(r.loraAlpha ?? "—") },
    { label: "Batch", get: (r) => String(r.batchSize ?? "—") },
    { label: "Learning rate", get: (r) => (r.learningRate ? String(r.learningRate) : "—") },
    { label: "Durasi", get: (r) => durationOf(r.startTime, r.endTime) },
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-2 flex items-center gap-2">
          <GitCompare className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold text-primary">Bandingkan run</h2>
          <span className="text-[12px] text-ink-soft">pilih 2–{MAX_SELECT} run</span>
        </div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {runs.map((run) => {
            const idx = selected.indexOf(run.id);
            const on = idx >= 0;
            return (
              <button
                key={run.id}
                type="button"
                onClick={() => toggle(run)}
                disabled={!on && selected.length >= MAX_SELECT}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-40",
                  on ? "border-primary bg-primary-soft" : "border-input bg-background hover:bg-surface-2"
                )}
              >
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: on ? COLORS[idx] : "var(--hairline)" }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{run.template}</span>
                  <span className="block truncate text-[11px] text-ink-soft">
                    {short(run.model)} · {short(run.dataset)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {chosen.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-[13px] text-ink-soft">
          Pilih run di atas buat lihat kurva loss + tabel perbandingan.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="mb-2 text-[13px] font-semibold text-ink">Kurva loss (overlay)</h3>
            <LossChart series={chosen.map((c) => ({ color: c.color, loss: lossById[c.run.id] ?? [] }))} />
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-medium text-ink-soft">Metrik</th>
                  {chosen.map((c) => (
                    <th key={c.run.id} className="px-3 py-2 text-left font-medium text-ink">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full" style={{ background: c.color }} aria-hidden />
                        <span className="max-w-[160px] truncate">{c.run.template}</span>
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5 text-ink-soft">{row.label}</td>
                    {chosen.map((c) => (
                      <td key={c.run.id} className="px-3 py-1.5 tabular-nums text-ink">
                        {row.get(c.run)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-b border-border last:border-0">
                  <td className="px-3 py-1.5 text-ink-soft">Langkah tercatat</td>
                  {chosen.map((c) => (
                    <td key={c.run.id} className="px-3 py-1.5 tabular-nums text-ink">
                      {(lossById[c.run.id]?.length ?? 0) || "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-3 py-1.5 font-medium text-ink-soft">Loss akhir</td>
                  {chosen.map((c) => {
                    const loss = lossById[c.run.id] ?? [];
                    return (
                      <td key={c.run.id} className="px-3 py-1.5 font-semibold tabular-nums text-primary">
                        {loss.length ? loss[loss.length - 1].toFixed(3) : "—"}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
