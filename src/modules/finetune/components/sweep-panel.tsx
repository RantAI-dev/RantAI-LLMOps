"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Sparkles, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { FinetuneOptions } from "@/lib/finetune";
import { buildCombos, useSweep, type SweepGrid } from "@/modules/finetune/hooks/use-sweep";
import { cn } from "@/lib/utils";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const inputClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Parse a comma/space list of numbers ("1e-4, 2e-4") into a numeric array. */
function parseList(raw: string): number[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

type Benchmark = { id: string; name: string };

/** Hyperparameter sweep: train a grid of configs, eval each, rank by score. */
export function SweepPanel({ options }: { options: FinetuneOptions }) {
  const { running, progress, results, error, runSweep } = useSweep();
  const [model, setModel] = useState("");
  const [dataset, setDataset] = useState("");
  const [benchmark, setBenchmark] = useState("arc_easy");
  const [coverage, setCoverage] = useState(10);
  const [lr, setLr] = useState("0.0002, 0.0004");
  const [loraR, setLoraR] = useState("8, 16");
  const [epochs, setEpochs] = useState("");
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/evals/options")
      .then((r) => r.json() as Promise<{ benchmarks?: Benchmark[] }>)
      .then((d) => {
        if (!cancelled) setBenchmarks(d.benchmarks ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const grid: SweepGrid = useMemo(
    () => ({
      learning_rate: parseList(lr),
      lora_r: parseList(loraR),
      num_train_epochs: parseList(epochs),
    }),
    [lr, loraR, epochs]
  );
  const comboCount = useMemo(() => buildCombos(grid).length, [grid]);

  const selectedModel = options.models.find((m) => m.id === model);
  const canRun = model && dataset && comboCount > 0 && !running;

  const ranked = [...results].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const best = ranked.find((r) => r.score != null);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold text-primary">Hyperparameter sweep</h2>
        </div>
        <p className="mb-3 text-[12px] text-ink-soft">
          Coba beberapa kombinasi setelan training otomatis → tiap hasil di-eval → diranking. Jalan{" "}
          <strong>satu per satu</strong> (train lalu eval), jadi bisa lama.
        </p>

        {options.models.length === 0 ? (
          <p className="rounded-md bg-surface-2 px-3 py-2 text-[13px] text-ink-soft">
            Belum ada base model yang bisa di-train. Download model non-GGUF dulu.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-ink">Base model</span>
                <select className={selectClass} value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="">Pilih model…</option>
                  {options.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-ink">Dataset</span>
                <select className={selectClass} value={dataset} onChange={(e) => setDataset(e.target.value)}>
                  <option value="">Pilih dataset…</option>
                  {options.datasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-ink">learning_rate</span>
                <input className={inputClass} value={lr} onChange={(e) => setLr(e.target.value)} placeholder="0.0002, 0.0004" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-ink">lora_r</span>
                <input className={inputClass} value={loraR} onChange={(e) => setLoraR(e.target.value)} placeholder="8, 16" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-ink">num_train_epochs</span>
                <input className={inputClass} value={epochs} onChange={(e) => setEpochs(e.target.value)} placeholder="1, 2" />
              </label>
            </div>
            <p className="mt-1.5 text-[11px] text-ink-soft">
              Pisah nilai pakai koma. Kosongin axis yang nggak mau di-sweep.
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-ink">Benchmark (eval)</span>
                <select className={selectClass} value={benchmark} onChange={(e) => setBenchmark(e.target.value)}>
                  {benchmarks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-ink">Coverage — {coverage}%</span>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={coverage}
                  onChange={(e) => setCoverage(Number(e.target.value))}
                  className="mt-2 w-full accent-primary"
                />
              </label>
            </div>

            {progress ? (
              <div className="mt-3 flex items-center gap-2">
                <Progress value={(progress.index / Math.max(1, progress.total)) * 100} className="h-1.5 flex-1" />
                <span className="text-[12px] tabular-nums text-ink-soft">
                  {progress.index + 1}/{progress.total} · {progress.phase === "training" ? "training" : "evaluating"}…
                </span>
              </div>
            ) : null}
            {error ? (
              <p className="mt-2 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
                {error}
              </p>
            ) : null}

            <div className="mt-4 flex items-center gap-3">
              <Button
                type="button"
                disabled={!canRun}
                onClick={() =>
                  runSweep({
                    baseModel: model,
                    baseModelArchitecture: selectedModel?.architecture,
                    dataset,
                    benchmark,
                    limit: coverage / 100,
                    grid,
                  })
                }
              >
                {running ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Running…
                  </>
                ) : (
                  `Run sweep (${comboCount || "…"} kombinasi)`
                )}
              </Button>
              <p className="text-[12px] text-ink-soft">{comboCount} training + {comboCount} eval.</p>
            </div>
          </>
        )}
      </div>

      {/* Results */}
      {results.length > 0 ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="mb-3 text-sm font-semibold text-primary">Hasil (diranking by accuracy)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[12px] text-ink-soft">
                  <th className="py-2 pr-3 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">learning_rate</th>
                  <th className="px-3 py-2 font-medium">lora_r</th>
                  <th className="px-3 py-2 font-medium">epochs</th>
                  <th className="px-3 py-2 text-right font-medium">Skor</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r) => {
                  const isBest = best != null && r.fusedModelId === best.fusedModelId && r.score != null;
                  return (
                    <tr key={r.index} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-3 text-ink-soft">{r.index + 1}</td>
                      <td className="px-3 py-2 font-mono text-[12px]">{r.combo.learning_rate ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-[12px]">{r.combo.lora_r ?? "—"}</td>
                      <td className="px-3 py-2 font-mono text-[12px]">{r.combo.num_train_epochs ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.score != null ? (
                          <span className={cn("inline-flex items-center gap-1", isBest && "font-semibold text-primary")}>
                            {isBest ? <Trophy className="size-3.5" aria-hidden /> : null}
                            {(r.score * 100).toFixed(1)}%
                          </span>
                        ) : (
                          <span className="text-danger">{r.status === "train-failed" ? "train gagal" : "eval gagal"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {best ? (
            <p className="mt-2 text-[12px] text-ink-soft">
              🏆 Setelan terbaik: lr={best.combo.learning_rate ?? "—"}, lora_r={best.combo.lora_r ?? "—"}, epochs=
              {best.combo.num_train_epochs ?? "—"} → {((best.score ?? 0) * 100).toFixed(1)}%. Model:{" "}
              <span className="font-mono">{best.fusedModelId}</span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
