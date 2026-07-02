"use client";

import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FinetuneOptions } from "@/lib/finetune";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function slug(s: string): string {
  return (s.split("/").pop() ?? s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function FinetuneForm({
  options,
  loading,
  submitting,
  error,
  onSubmit,
  onDeleteDataset,
}: {
  options: FinetuneOptions;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: (body: Record<string, unknown>) => Promise<boolean>;
  onDeleteDataset: (id: string) => Promise<void>;
}) {
  const [baseModel, setBaseModel] = useState("");
  const [dataset, setDataset] = useState("");
  const [adaptorName, setAdaptorName] = useState("");
  const [epochs, setEpochs] = useState(1);
  const [loraR, setLoraR] = useState(8);
  const [learningRate, setLearningRate] = useState(0.0002);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [touchedName, setTouchedName] = useState(false);
  const [deletingDataset, setDeletingDataset] = useState(false);

  // Prefill the dataset from `?dataset=` (e.g. picked in Hub → "Use in fine-tune").
  // Read from the URL once on mount (not lazy useState init) to avoid an SSR/
  // client hydration mismatch on the <select value>.
  useEffect(() => {
    const ds = new URLSearchParams(window.location.search).get("dataset");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot sync from the URL on mount
    if (ds) setDataset(ds);
  }, []);

  // Show the chosen dataset in the select even if it's a HF id not in the local
  // list — the trainer pulls HF datasets by id at runtime.
  const datasetOptions = useMemo(() => {
    const list = [...options.datasets];
    if (dataset && !list.some((d) => d.id === dataset)) {
      list.unshift({ id: dataset, name: `${dataset} (HF)`, sizeMb: null, downloaded: false });
    }
    return list;
  }, [options.datasets, dataset]);

  const selectedModel = options.models.find((m) => m.id === baseModel);
  const selectedDataset = datasetOptions.find((d) => d.id === dataset);

  // Suggest an adaptor name from the chosen model + dataset until the user edits it.
  const suggestedName = useMemo(
    () => (baseModel && dataset ? `${slug(baseModel)}-${slug(dataset)}` : ""),
    [baseModel, dataset]
  );
  const effectiveName = touchedName ? adaptorName : suggestedName;

  const canSubmit = baseModel && dataset && effectiveName && !submitting;

  async function handleSubmit() {
    const ok = await onSubmit({
      baseModel,
      baseModelArchitecture: selectedModel?.architecture,
      dataset,
      adaptorName: effectiveName,
      epochs,
      loraR,
      learningRate,
    });
    if (ok && !touchedName) setAdaptorName("");
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="size-4 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold text-primary">New fine-tune (LoRA)</h2>
      </div>

      {options.models.length === 0 && !loading ? (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-[13px] text-ink-soft">
          Belum ada base model yang bisa di-train. Download model <strong>non-GGUF</strong>{" "}
          (mis. Qwen2.5-0.5B / Llama-3.2-1B) lewat picker di Interact dulu.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-ink">Base model</span>
          <select
            className={selectClass}
            value={baseModel}
            onChange={(e) => setBaseModel(e.target.value)}
          >
            <option value="">Select a model…</option>
            {options.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.architecture})
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-ink">Dataset</span>
          <div className="flex items-center gap-1.5">
            <select
              className={selectClass}
              value={dataset}
              onChange={(e) => setDataset(e.target.value)}
            >
              <option value="">Select a dataset…</option>
              {datasetOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.downloaded ? "" : " — will download"}
                </option>
              ))}
            </select>
            {selectedDataset?.downloaded ? (
              <button
                type="button"
                disabled={deletingDataset}
                onClick={async () => {
                  setDeletingDataset(true);
                  try {
                    await onDeleteDataset(dataset);
                    setDataset("");
                  } finally {
                    setDeletingDataset(false);
                  }
                }}
                aria-label="Delete dataset"
                title="Delete this dataset"
                className="grid size-9 shrink-0 place-items-center rounded-md border border-input text-ink-soft hover:text-danger disabled:opacity-60"
              >
                {deletingDataset ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="size-4" aria-hidden />
                )}
              </button>
            ) : null}
          </div>
        </label>

        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-ink">Adaptor name</span>
          <Input
            value={effectiveName}
            onChange={(e) => {
              setTouchedName(true);
              setAdaptorName(e.target.value);
            }}
            placeholder="my-finetune"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-ink">Epochs</span>
          <Input
            type="number"
            min={1}
            value={epochs}
            onChange={(e) => setEpochs(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="mt-3 text-[12px] font-medium text-ink-soft hover:text-ink"
      >
        {showAdvanced ? "− Hide" : "+ Advanced"} (LoRA rank, learning rate)
      </button>

      {showAdvanced ? (
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">LoRA rank (r)</span>
            <Input
              type="number"
              min={1}
              value={loraR}
              onChange={(e) => setLoraR(Math.max(1, Number(e.target.value) || 8))}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">Learning rate</span>
            <Input
              type="number"
              step="0.0001"
              min={0}
              value={learningRate}
              onChange={(e) => setLearningRate(Number(e.target.value) || 0.0002)}
            />
          </label>
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {error}
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-3">
        <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
          {submitting ? "Starting…" : "Start fine-tune"}
        </Button>
        <p className="text-[12px] text-ink-soft">
          Berjalan di Transformer Lab (GPU). Model kecil + dataset kecil = paling cepat.
        </p>
      </div>
    </div>
  );
}
