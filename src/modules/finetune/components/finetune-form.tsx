"use client";

import Link from "next/link";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FinetuneOptions } from "@/lib/finetune";
import { HfSearch } from "@/modules/hub/components/hf-search";
import { cn } from "@/lib/utils";

type Method = "sft" | "grpo" | "tts";

// Mirror of the TTS trainer's defaults (kept local so this client component never
// pulls the server-only finetune.ts module into the browser bundle). The backend
// applies these same defaults regardless.
const TTS_DEFAULT_MODEL = "unsloth/orpheus-3b-0.1-ft";
const TTS_DEFAULT_ARCHITECTURE = "OrpheusForConditionalGeneration";

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
  const [method, setMethod] = useState<Method>("sft");
  const [baseModel, setBaseModel] = useState("");
  // Prefilled HF search query when arriving from Model Registry's "Fine-tune".
  const [baseQuery, setBaseQuery] = useState("");
  const [dataset, setDataset] = useState("");
  const [adaptorName, setAdaptorName] = useState("");
  const [epochs, setEpochs] = useState(1);
  const [loraR, setLoraR] = useState(8);
  const [loraAlpha, setLoraAlpha] = useState(16);
  const [learningRate, setLearningRate] = useState(0.0002);
  // -1 = ikut `epochs`. Angka positif MENIMPA epochs, jadi itu cuma untuk uji cepat.
  const [maxSteps, setMaxSteps] = useState(-1);
  // Token per sampel. Dataset gaya RAG (konteks retrieval ikut di prompt) gampang
  // tembus 2048 — kelebihannya dipotong diam-diam, jadi ini wajib bisa dinaikkan.
  const [maxSeqLength, setMaxSeqLength] = useState(2048);
  // Off by default: GB10 has 128 GB unified memory, so 4-bit only adds compute —
  // and its kernels are reported to stall on sm_121. For small-VRAM hosts only.
  const [loadIn4bit, setLoadIn4bit] = useState(false);
  const [inputField, setInputField] = useState("question");
  const [outputField, setOutputField] = useState("answer");
  const [audioColumn, setAudioColumn] = useState("audio");
  const [textColumn, setTextColumn] = useState("text_to_synthesize");
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

  // Prefill the HF base search from `?base=` (Model Registry → "Fine-tune"). The
  // registry model is a GGUF (not a valid training base), so we seed the combobox
  // query with its name instead of fake-selecting it.
  useEffect(() => {
    const b = new URLSearchParams(window.location.search).get("base");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot sync from the URL on mount
    if (b) setBaseQuery(b);
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

  // TTS trains an Orpheus/CSM audio model — not in the normal trainable-LLM list —
  // so inject it as a base option when TTS is the method.
  const modelOptions = useMemo(() => {
    if (method !== "tts") return options.models;
    const list = [...options.models];
    if (!list.some((m) => m.id === TTS_DEFAULT_MODEL)) {
      list.unshift({
        id: TTS_DEFAULT_MODEL,
        name: "Orpheus 3B (TTS)",
        architecture: TTS_DEFAULT_ARCHITECTURE,
        sizeMb: 6000,
        isGguf: false,
        downloaded: false,
      });
    }
    return list;
  }, [options.models, method]);

  // Switching method also snaps the base model to a sensible default for it, so
  // e.g. a Qwen picked for SFT doesn't linger (wrong arch) after switching to TTS.
  function chooseMethod(next: Method) {
    setMethod(next);
    if (next === "tts") {
      setBaseModel(TTS_DEFAULT_MODEL);
    } else if (baseModel === TTS_DEFAULT_MODEL) {
      setBaseModel("");
    }
  }

  const selectedModel = modelOptions.find((m) => m.id === baseModel);
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
      method,
      baseModel,
      baseModelArchitecture: selectedModel?.architecture,
      dataset,
      adaptorName: effectiveName,
      epochs,
      loraR,
      loraAlpha,
      learningRate,
      maxSteps,
      maxSeqLength,
      loadIn4bit,
      ...(method === "grpo"
        ? { datasetInputField: inputField, datasetOutputField: outputField }
        : {}),
      ...(method === "tts" ? { audioColumn, textColumn } : {}),
    });
    if (ok && !touchedName) setAdaptorName("");
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="size-4 text-primary" aria-hidden />
        <h2 className="text-sm font-semibold text-primary">New fine-tune (LoRA)</h2>
      </div>

      <div className="mb-3">
        <span className="mb-1.5 block text-[13px] font-medium text-ink">Training method</span>
        <div className="grid grid-cols-3 gap-2">
          <MethodButton
            active={method === "sft"}
            onClick={() => chooseMethod("sft")}
            title="SFT"
            desc="Instruction tuning (prompt → completion)"
          />
          <MethodButton
            active={method === "grpo"}
            onClick={() => chooseMethod("grpo")}
            title="GRPO · RL"
            desc="Reasoning — di-reward jawaban benar (Unsloth)"
          />
          <MethodButton
            active={method === "tts"}
            onClick={() => chooseMethod("tts")}
            title="TTS"
            desc="Text-to-speech (Orpheus, butuh GPU besar)"
          />
        </div>
        {method === "grpo" ? (
          <div className="mt-2 rounded-md border border-primary-soft bg-primary-tint-2 p-2.5 text-[12px]">
            <p className="text-ink">
              Model belajar <strong>reasoning</strong>: output{" "}
              <code>&lt;reasoning&gt;…&lt;/reasoning&gt;&lt;answer&gt;…&lt;/answer&gt;</code>, di-reward
              kalau jawabannya cocok. Butuh dataset dengan kolom pertanyaan + jawaban (mis.{" "}
              <code>openai/gsm8k</code>).
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-soft">Kolom pertanyaan</span>
                <Input value={inputField} onChange={(e) => setInputField(e.target.value)} placeholder="question" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-soft">Kolom jawaban</span>
                <Input value={outputField} onChange={(e) => setOutputField(e.target.value)} placeholder="answer" />
              </label>
            </div>
          </div>
        ) : null}
        {method === "tts" ? (
          <div className="mt-2 rounded-md border border-primary-soft bg-primary-tint-2 p-2.5 text-[12px]">
            <p className="text-ink">
              Melatih model <strong>text-to-speech</strong> (Orpheus) supaya niru suara dari dataset{" "}
              <code>(audio, teks)</code>. Butuh dataset dengan kolom audio + teks (mis.{" "}
              <code>bosonai/EmergentTTS-Eval</code>).
            </p>
            <p className="mt-1.5 rounded bg-warning-soft px-2 py-1 text-[11px] text-warning">
              ⚠️ Base model 3B — trainer resminya minta GPU besar (RTX 3090). Di GPU ~6 GB
              kemungkinan gagal (kehabisan VRAM). Wiring-nya benar, tinggal jalanin di GPU memadai.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-soft">Kolom audio</span>
                <Input value={audioColumn} onChange={(e) => setAudioColumn(e.target.value)} placeholder="audio" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-soft">Kolom teks</span>
                <Input value={textColumn} onChange={(e) => setTextColumn(e.target.value)} placeholder="text_to_synthesize" />
              </label>
            </div>
          </div>
        ) : null}
      </div>

      {modelOptions.length === 0 && !loading ? (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-[13px] text-ink-soft">
          Belum ada base model yang bisa di-train. Download model <strong>non-GGUF</strong>{" "}
          (mis. Qwen2.5-0.5B / Llama-3.2-1B) lewat picker di Interact dulu.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-ink">Base model</span>
          <HfSearch
            key={baseQuery || "model"}
            kind="model"
            selected={baseModel}
            onPick={setBaseModel}
            initialQuery={baseQuery}
            presets={modelOptions.map((m) => ({ id: m.id, label: `${m.name} (${m.architecture})` }))}
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-[13px] font-medium text-ink">Dataset</span>
          <div className="flex items-start gap-1.5">
            <div className="min-w-0 flex-1">
              <HfSearch
                kind="dataset"
                selected={dataset}
                onPick={setDataset}
                presets={datasetOptions.map((d) => ({ id: d.id, label: d.name, local: d.downloaded }))}
              />
            </div>
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
                title="Hapus dataset lokal ini"
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
        {showAdvanced ? "− Sembunyikan" : "+ Advanced"} (LoRA, learning rate, max steps, panjang konteks)
      </button>

      {showAdvanced ? (
        <div className="mt-2 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
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
              <span className="mb-1 block text-[13px] font-medium text-ink">LoRA alpha</span>
              <Input
                type="number"
                min={1}
                value={loraAlpha}
                onChange={(e) => setLoraAlpha(Math.max(1, Number(e.target.value) || 16))}
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
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-ink">Max steps</span>
              <Input
                type="number"
                min={-1}
                value={maxSteps}
                onChange={(e) => setMaxSteps(Number.isFinite(Number(e.target.value)) ? Number(e.target.value) : 60)}
              />
              <span className="mt-1 block text-[11px] text-ink-soft">
                <code>-1</code> (default) = ikut epochs penuh. Angka positif{" "}
                <strong>menimpa epochs</strong> — cuma buat uji cepat.
              </span>
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-ink">Panjang konteks maks</span>
              <Input
                type="number"
                min={256}
                step={512}
                value={maxSeqLength}
                onChange={(e) => setMaxSeqLength(Math.max(256, Number(e.target.value) || 2048))}
              />
              <span className="mt-1 block text-[11px] text-ink-soft">
                Token per sampel (konteks + pertanyaan + jawaban). Yang lebih panjang{" "}
                <strong>dipotong diam-diam</strong>. Dataset gaya RAG butuh <code>4096</code>–
                <code>8192</code>.
              </span>
            </label>
          </div>

          <label className="flex cursor-pointer items-start gap-2 rounded-md bg-surface-2 px-3 py-2">
            <input
              type="checkbox"
              checked={loadIn4bit}
              onChange={(e) => setLoadIn4bit(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span className="text-[11px] leading-4 text-ink-soft">
              <span className="font-medium text-ink">Muat model 4-bit (QLoRA)</span> — hemat memori
              buat GPU kecil. <strong>Biarkan mati di GB10</strong>: memori terpadu 128 GB bikin ini
              gak perlu, dan kernel 4-bit dilaporkan macet di sm_121.
            </span>
          </label>

          <p className="rounded-md bg-surface-2 px-3 py-2 text-[11px] leading-4 text-ink-soft">
            Model <strong>gated</strong> (Llama/Gemma)?{" "}
            <Link href="/settings" className="font-medium text-accent underline-offset-2 hover:underline">
              Set HuggingFace token di Settings
            </Link>{" "}
            — sekali simpan, kepakai di semua fine-tune &amp; download.
          </p>
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

function MethodButton({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-lg border px-3 py-2 text-left transition-colors",
        active ? "border-primary bg-primary-soft" : "border-input bg-background hover:bg-surface-2"
      )}
    >
      <span className={cn("block text-[13px] font-medium", active ? "text-primary" : "text-ink")}>
        {title}
      </span>
      <span className="mt-0.5 block text-[11px] leading-4 text-ink-soft">{desc}</span>
    </button>
  );
}

