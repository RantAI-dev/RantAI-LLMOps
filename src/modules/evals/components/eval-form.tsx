"use client";

import { FlaskConical } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { EvalOptions } from "@/lib/evals";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function EvalForm({
  options,
  submitting,
  error,
  onSubmit,
}: {
  options: EvalOptions;
  submitting: boolean;
  error: string | null;
  onSubmit: (body: {
    model: string;
    modelArchitecture?: string;
    benchmark: string;
    limit: number;
    fineTuned?: boolean;
  }) => Promise<boolean>;
}) {
  const [model, setModel] = useState("");
  const [benchmark, setBenchmark] = useState("arc_easy");
  const [coverage, setCoverage] = useState(5); // % of the benchmark

  const selectedModel = options.models.find((m) => m.id === model);
  const selectedBench = options.benchmarks.find((b) => b.id === benchmark);
  const canSubmit = model && benchmark && !submitting;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <FlaskConical className="size-4 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold text-primary">New evaluation</h2>
      </div>

      {options.models.length === 0 ? (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-[13px] text-ink-soft">
          Belum ada model yang bisa di-eval. Download model <strong>non-GGUF</strong> (mis.
          Qwen2.5-0.5B) lewat picker di Interact dulu.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-ink">Model</span>
          <select className={selectClass} value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">Select a model…</option>
            {options.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.fineTuned ? " (fine-tuned)" : ""}
              </option>
            ))}
          </select>
        </label>

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
            Cakupan — {coverage}% dari benchmark
          </span>
          <input
            type="range"
            min={1}
            max={100}
            value={coverage}
            onChange={(e) => setCoverage(Number(e.target.value))}
            className="w-full accent-primary"
          />
          {/* A percentage is abstract; the question count is the actual cost, and
              it is what makes "naikin ke 100%" a decision rather than advice. */}
          <span className="text-[11px] text-ink-soft">
            {selectedBench
              ? `± ${Math.round((selectedBench.questions * coverage) / 100).toLocaleString("id-ID")} dari ${selectedBench.questions.toLocaleString("id-ID")} soal. `
              : ""}
            Lebih kecil = lebih cepat. Buat skor yang bisa dikutip, naikkan ke 100%.
          </span>
        </label>
      </div>

      {selectedBench ? (
        <p className="mt-2 text-[12px] text-ink-soft">
          ℹ️ {selectedBench.description} Menebak acak dapat{" "}
          <strong>{Math.round(selectedBench.chance * 100)}%</strong>, jadi skor di sekitar
          angka itu berarti model belum menunjukkan kemampuan apa pun.
        </p>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {error}
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <Button
          type="button"
          disabled={!canSubmit}
          onClick={() =>
            onSubmit({
              model,
              modelArchitecture: selectedModel?.architecture,
              benchmark,
              limit: coverage / 100,
              fineTuned: selectedModel?.fineTuned,
            })
          }
        >
          {submitting ? "Starting…" : "Run evaluation"}
        </Button>
        <p className="text-[12px] text-ink-soft">
          Berjalan di Transformer Lab (GPU). Eval pause inference sementara.
        </p>
      </div>
    </div>
  );
}
