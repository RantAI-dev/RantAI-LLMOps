"use client";

import { FlaskConical } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/tooltip";
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
      <div className="mb-3 flex items-center gap-1.5">
        <FlaskConical className="size-4 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold text-primary">New evaluation</h2>
        <InfoTip label="About running an evaluation">
          Runs in Transformer Lab (GPU). The eval pauses inference while it runs.
        </InfoTip>
      </div>

      {options.models.length === 0 ? (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-[13px] text-ink-soft">
          No models to evaluate yet. Download a <strong>non-GGUF</strong> model (e.g. Qwen2.5-0.5B)
          from the picker in Interact first.
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

        <div className="block">
          <span className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-ink">
            <label htmlFor="eval-benchmark">Benchmark</label>
            {selectedBench ? (
              <InfoTip label={`About ${selectedBench.name}`}>
                {selectedBench.description} Random guessing scores{" "}
                <strong>{Math.round(selectedBench.chance * 100)}%</strong>, so a score around that
                means the model has not shown any capability yet.
              </InfoTip>
            ) : null}
          </span>
          <select
            id="eval-benchmark"
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
        </div>

        <div className="block">
          <span className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-ink">
            <label htmlFor="eval-coverage">Coverage — {coverage}% of the benchmark</label>
            {/* A percentage is abstract; the question count is the actual cost, and
                it is what makes "raise to 100%" a decision rather than advice. */}
            <InfoTip label="About coverage">
              {selectedBench
                ? `± ${Math.round((selectedBench.questions * coverage) / 100).toLocaleString("id-ID")} of ${selectedBench.questions.toLocaleString("id-ID")} questions. `
                : ""}
              Smaller = faster. For a citable score, raise it to 100%.
            </InfoTip>
          </span>
          <input
            id="eval-coverage"
            type="range"
            min={1}
            max={100}
            value={coverage}
            onChange={(e) => setCoverage(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </div>
      </div>

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
      </div>
    </div>
  );
}
