"use client";

import { useMemo, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { InfoTip } from "@/components/ui/tooltip";
import type { FinetuneOptions } from "@/lib/finetune";
import { buildCombos, useSweep, type SweepGrid } from "@/modules/finetune/hooks/use-sweep";

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

/** Hyperparameter sweep: train a grid of hyperparameter configs (one per combo). */
export function SweepPanel({ options }: { options: FinetuneOptions }) {
  const { running, progress, results, error, runSweep, stopSweep } = useSweep();
  const [model, setModel] = useState("");
  const [dataset, setDataset] = useState("");
  const [lr, setLr] = useState("0.0002, 0.0004");
  const [loraR, setLoraR] = useState("8, 16");
  const [epochs, setEpochs] = useState("");

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

  const trained = results.filter((r) => r.status === "ok");

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-1.5">
          <Sparkles className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold text-primary">Hyperparameter sweep</h2>
          <InfoTip label="About hyperparameter sweeps">
            Trains several training-setting combinations automatically — each combination becomes an
            adapter. They run <strong>one at a time</strong>, so it can take a while. Compare the
            results by using <strong>Export</strong>, then chatting in Generations.
          </InfoTip>
        </div>

        {options.models.length === 0 ? (
          <p className="rounded-md bg-surface-2 px-3 py-2 text-[13px] text-ink-soft">
            No trainable base model yet. Download a non-GGUF model first.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-ink">Base model</span>
                <select className={selectClass} value={model} onChange={(e) => setModel(e.target.value)}>
                  <option value="">Select model…</option>
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
                  <option value="">Select dataset…</option>
                  {options.datasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-3 flex items-center gap-1.5">
              <span className="text-[12px] font-medium text-ink-soft">Sweep axes</span>
              <InfoTip label="About sweep axes">
                Separate values with commas. Leave an axis empty to exclude it from the sweep.
              </InfoTip>
            </div>
            <div className="mt-1.5 grid gap-3 sm:grid-cols-3">
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

            {progress ? (
              <div className="mt-3 flex items-center gap-2">
                <Progress value={(progress.index / Math.max(1, progress.total)) * 100} className="h-1.5 flex-1" />
                <span className="text-[12px] tabular-nums text-ink-soft">
                  {progress.index + 1}/{progress.total} · training…
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
                    grid,
                  })
                }
              >
                {running ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Running…
                  </>
                ) : (
                  `Run sweep (${comboCount || "…"} combinations)`
                )}
              </Button>
              {running ? (
                <button
                  type="button"
                  onClick={stopSweep}
                  className="rounded-md px-2 py-1 text-[12px] font-medium text-ink-soft hover:bg-surface-2 hover:text-danger"
                >
                  Stop
                </button>
              ) : null}
              <p className="text-[12px] text-ink-soft">{comboCount} training run(s).</p>
            </div>
          </>
        )}
      </div>

      {/* Results */}
      {results.length > 0 ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="mb-3 text-sm font-semibold text-primary">Results (trained adapters)</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[12px] text-ink-soft">
                  <th className="py-2 pr-3 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">learning_rate</th>
                  <th className="px-3 py-2 font-medium">lora_r</th>
                  <th className="px-3 py-2 font-medium">epochs</th>
                  <th className="px-3 py-2 font-medium">Adaptor</th>
                  <th className="px-3 py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.index} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 text-ink-soft">{r.index + 1}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">{r.combo.learning_rate ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">{r.combo.lora_r ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">{r.combo.num_train_epochs ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-[12px]">
                      {r.status === "ok" ? r.adaptorName : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {r.status === "ok" ? (
                        <span className="text-primary">trained ✓</span>
                      ) : (
                        <span className="text-danger">training failed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {trained.length > 0 ? (
            <p className="mt-2 text-[12px] text-ink-soft">
              {trained.length} adapter(s) trained. Open <strong>Fine-tune → Fine-tuned tab</strong>{" "}
              (or the model picker) to <strong>Export</strong> the ones you like, then compare them in
              Generations.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
