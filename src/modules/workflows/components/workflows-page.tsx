"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleAlert, Loader2, Play, Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePipeline, type Stage, type StageStatus } from "@/modules/workflows/hooks/use-pipeline";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
const inputClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

type CatalogModel = { id: string; name: string; architecture: string };
type Dataset = { id: string; name: string };
type FinetuneOptions = { models?: CatalogModel[]; datasets?: Dataset[] };
type Benchmark = { id: string; name: string };

function StageIcon({ status }: { status: StageStatus }) {
  if (status === "running") return <Loader2 className="size-4 animate-spin text-primary" />;
  if (status === "done") return <CheckCircle2 className="size-4 text-emerald-600" />;
  if (status === "failed") return <CircleAlert className="size-4 text-danger" />;
  return <span className="size-4 rounded-full border-2 border-border" />;
}

function StageRow({ stage, last }: { stage: Stage; last: boolean }) {
  const dim = stage.status === "pending" || stage.status === "skipped";
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <StageIcon status={stage.status} />
        {!last ? <span className="my-1 w-px flex-1 bg-border" /> : null}
      </div>
      <div className={cn("pb-4", dim && "opacity-60")}>
        <p className="text-sm font-medium text-ink">{stage.label}</p>
        <p className="text-[12px] text-ink-soft">
          {stage.status === "skipped" ? "dilewati" : stage.detail || stage.status}
        </p>
      </div>
    </div>
  );
}

/** Workflows: one-click fine-tune → eval → export GGUF pipeline. */
export function WorkflowsPage() {
  const { running, stages, result, error, run } = usePipeline();
  const [opts, setOpts] = useState<FinetuneOptions | null>(null);
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);
  const [model, setModel] = useState("");
  const [dataset, setDataset] = useState("");
  const [adaptorName, setAdaptorName] = useState("");
  const [epochs, setEpochs] = useState(1);
  const [benchmark, setBenchmark] = useState("arc_easy");
  const [coverage, setCoverage] = useState(10);
  const [doEval, setDoEval] = useState(true);
  const [doExport, setDoExport] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/finetune/options").then((r) => r.json() as Promise<FinetuneOptions>),
      fetch("/api/evals/options").then((r) => r.json() as Promise<{ benchmarks?: Benchmark[] }>),
    ])
      .then(([o, e]) => {
        if (cancelled) return;
        setOpts(o ?? {});
        setBenchmarks(e?.benchmarks ?? []);
      })
      .catch(() => {
        if (!cancelled) setOpts({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const models = useMemo(() => opts?.models ?? [], [opts]);
  const datasets = opts?.datasets ?? [];
  const selectedModel = useMemo(() => models.find((m) => m.id === model), [models, model]);
  const canRun = model && dataset && adaptorName.trim() && !running;

  const handleRun = () => {
    run({
      baseModel: model,
      baseModelArchitecture: selectedModel?.architecture,
      dataset,
      adaptorName: adaptorName.trim().replace(/[^a-zA-Z0-9._-]/g, "-"),
      epochs,
      benchmark,
      coverage,
      doEval,
      doExport,
    });
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-primary">
          <Workflow className="size-5" /> Workflows
        </h1>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          Pipeline LLMOps <strong>sekali klik</strong>: fine-tune → eval → export GGUF, otomatis
          berurutan. Hasil akhir: model fine-tuned + skor benchmark + siap di-chat.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        {models.length === 0 ? (
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
                  {models.map((m) => (
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
                  {datasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-ink">Nama adaptor</span>
                <input
                  className={inputClass}
                  value={adaptorName}
                  onChange={(e) => setAdaptorName(e.target.value)}
                  placeholder="mis. rugby-pipeline"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-ink">Epochs</span>
                <input
                  type="number"
                  min={1}
                  max={10}
                  className={inputClass}
                  value={epochs}
                  onChange={(e) => setEpochs(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px] text-ink">
                <input type="checkbox" className="accent-primary" checked={doEval} onChange={(e) => setDoEval(e.target.checked)} />
                Eval setelah train
              </label>
              <label className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[13px] text-ink">
                <input type="checkbox" className="accent-primary" checked={doExport} onChange={(e) => setDoExport(e.target.checked)} />
                Export GGUF (biar bisa di-chat)
              </label>
            </div>

            {doEval ? (
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
            ) : null}

            {error ? (
              <p className="mt-3 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
                {error}
              </p>
            ) : null}

            <div className="mt-4 flex items-center gap-3">
              <Button type="button" disabled={!canRun} onClick={handleRun}>
                {running ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Running…
                  </>
                ) : (
                  <>
                    <Play className="size-4" /> Jalankan pipeline
                  </>
                )}
              </Button>
              <p className="text-[12px] text-ink-soft">Otomatis berurutan. Bisa beberapa menit.</p>
            </div>
          </>
        )}
      </div>

      {/* Progress stepper */}
      {stages.length > 0 ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold text-primary">Progress</h2>
          {stages.map((s, i) => (
            <StageRow key={s.key} stage={s} last={i === stages.length - 1} />
          ))}
          {result && !running ? (
            <div className="mt-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
              {result.fusedModelId ? (
                <>
                  ✅ Pipeline selesai. Model <span className="font-mono">{result.adaptorName}</span>
                  {result.score != null ? ` · skor ${(result.score * 100).toFixed(1)}%` : ""}
                  {result.ggufReady ? " · GGUF siap → bisa di-chat di Interact (tab Fine-tuned)" : ""}
                  .
                </>
              ) : (
                "Pipeline berhenti sebelum selesai — lihat detail tiap tahap di atas."
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
