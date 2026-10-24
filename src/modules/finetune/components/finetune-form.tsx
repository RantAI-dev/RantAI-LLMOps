"use client";

import Link from "next/link";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoTip } from "@/components/ui/tooltip";
import type { FinetuneOptions } from "@/lib/finetune";
import { HfSearch } from "@/modules/hub/components/hf-search";
import { cn } from "@/lib/utils";

type Method = "sft" | "grpo" | "tts" | "decision";

// Mirror of the TTS trainer's defaults (kept local so this client component never
// pulls the server-only finetune.ts module into the browser bundle). The backend
// applies these same defaults regardless.
const TTS_DEFAULT_MODEL = "unsloth/orpheus-3b-0.1-ft";
const TTS_DEFAULT_ARCHITECTURE = "OrpheusForConditionalGeneration";

// Decision models (System One): a language model plus a decision head. Mirrors
// DECISION_DEFAULT_MODEL / buildDecisionParameters in finetune.ts (kept local, same reason as above).
// Qwen3.5 is first because it is the one base with a complete train → GGUF → llama.cpp serving path;
// the SEA-LION bases train fine but are served through the PyTorch decision server only.
const DECISION_DEFAULT_MODEL = "unsloth/Qwen3.5-2B";
const DECISION_MODELS = [
  { id: "unsloth/Qwen3.5-2B", name: "Qwen3.5 2B (recommended)", architecture: "Qwen3_5ForConditionalGeneration", sizeMb: 4500 },
  { id: "unsloth/Qwen3.5-0.8B", name: "Qwen3.5 0.8B (fast test)", architecture: "Qwen3_5ForConditionalGeneration", sizeMb: 1800 },
  { id: "unsloth/Qwen3.5-4B", name: "Qwen3.5 4B", architecture: "Qwen3_5ForConditionalGeneration", sizeMb: 8500 },
  { id: "aisingapore/Qwen-SEA-LION-v4-8B-VL", name: "SEA-LION v4 8B (PyTorch serving only)", architecture: "Qwen3VLForConditionalGeneration", sizeMb: 16300 },
  { id: "aisingapore/Gemma-SEA-LION-v4-4B-VL", name: "SEA-LION v4 4B (PyTorch serving only)", architecture: "Gemma3ForConditionalGeneration", sizeMb: 8000 },
] as const;

// Starting values per method. Switching to or from "decision" swaps the whole set, so a value the
// user typed is not silently kept at a number that only makes sense for the other method.
const SFT_DEFAULTS = { loraR: 8, loraAlpha: 16, learningRate: 0.0002, maxSeqLength: 2048 };
const DECISION_DEFAULTS = { loraR: 64, loraAlpha: 64, learningRate: 0.0001, maxSeqLength: 4096 };

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
  presetDataset,
}: {
  options: FinetuneOptions;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  onSubmit: (body: Record<string, unknown>) => Promise<boolean>;
  onDeleteDataset: (id: string) => Promise<void>;
  /** When set (e.g. a just-created dataset), select it in the dataset field. */
  presetDataset?: string;
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
  // 0 keeps Unsloth on its fast-patching path (it warns of a performance hit above
  // 0). Raise only if evaluation shows the adapter overfitting.
  const [loraDropout, setLoraDropout] = useState(0);
  const [learningRate, setLearningRate] = useState(0.0002);
  // -1 = ikut `epochs`. Angka positif MENIMPA epochs, jadi itu cuma untuk uji cepat.
  const [maxSteps, setMaxSteps] = useState(-1);
  // Token per sampel. Dataset gaya RAG (konteks retrieval ikut di prompt) gampang
  // tembus 2048 — kelebihannya dipotong diam-diam, jadi ini wajib bisa dinaikkan.
  const [maxSeqLength, setMaxSeqLength] = useState(2048);
  // Tiap berapa langkah eval loss diukur. Default trainer sendiri 5 — dipilih supaya
  // demo pendek tetap punya kurva. Pada dataset sungguhan itu mahal: terukur pada run
  // 2.540 baris, satu eval lewat 254 sampel validasi makan 112 detik, jadi eval tiap 5
  // langkah menghabiskan 3,6 jam untuk eval melawan 1,3 jam melatih — 73% jam dinding,
  // demi 114 titik kurva yang 11 titik sudah cukup menggambarkannya.
  const [evalSteps, setEvalSteps] = useState(50);
  // Off by default: GB10 has 128 GB unified memory, so 4-bit only adds compute —
  // and its kernels are reported to stall on sm_121. For small-VRAM hosts only.
  const [loadIn4bit, setLoadIn4bit] = useState(false);
  // Decision method only.
  const [headLearningRate, setHeadLearningRate] = useState(0.0003);
  const [headWarmupSteps, setHeadWarmupSteps] = useState(0);
  const [holdoutFraction, setHoldoutFraction] = useState(0.1);
  const [gradAccum, setGradAccum] = useState(4);
  const [hfSubset, setHfSubset] = useState("");
  const [saveMerged, setSaveMerged] = useState(false);
  const [exportGguf, setExportGguf] = useState(false);
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

  // Select a dataset the "New dataset" form just created (its s3:// ref or id).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconcile the field to the newly-created dataset
    if (presetDataset) setDataset(presetDataset);
  }, [presetDataset]);

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
    if (method === "decision") {
      const list = [...options.models];
      for (const m of [...DECISION_MODELS].reverse()) {
        if (!list.some((x) => x.id === m.id)) list.unshift({ ...m, isGguf: false, downloaded: false });
      }
      return list;
    }
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
    const swap = (d: typeof SFT_DEFAULTS) => {
      setLoraR(d.loraR);
      setLoraAlpha(d.loraAlpha);
      setLearningRate(d.learningRate);
      setMaxSeqLength(d.maxSeqLength);
    };
    if (next === "decision" && method !== "decision") swap(DECISION_DEFAULTS);
    if (next !== "decision" && method === "decision") swap(SFT_DEFAULTS);
    setMethod(next);
    if (next === "tts") {
      setBaseModel(TTS_DEFAULT_MODEL);
    } else if (next === "decision") {
      // A base picked for another method (an SFT chat model, the TTS one) is the wrong thing here.
      if (!DECISION_MODELS.some((m) => m.id === baseModel)) setBaseModel(DECISION_DEFAULT_MODEL);
    } else if (baseModel === TTS_DEFAULT_MODEL || (method === "decision" && baseModel === DECISION_DEFAULT_MODEL)) {
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
  // A Hugging Face id on a decision run: the server downloads and converts it, then starts the job.
  const decisionFromHf = method === "decision" && /^[\w.-]+\/[\w.-]+$/.test(dataset.trim()) && !dataset.startsWith(".");

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
      loraDropout,
      learningRate,
      maxSteps,
      maxSeqLength,
      evalSteps,
      loadIn4bit,
      ...(method === "grpo"
        ? { datasetInputField: inputField, datasetOutputField: outputField }
        : {}),
      ...(method === "tts" ? { audioColumn, textColumn } : {}),
      ...(method === "decision"
        ? {
            headLearningRate,
            headWarmupSteps,
            holdoutFraction,
            gradientAccumulationSteps: gradAccum,
            saveMerged: saveMerged || exportGguf,
            exportGguf,
            ...(decisionFromHf && hfSubset.trim() ? { datasetConfig: hfSubset.trim() } : {}),
          }
        : {}),
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
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
            desc="Reasoning — rewards correct answers (Unsloth)"
          />
          <MethodButton
            active={method === "tts"}
            onClick={() => chooseMethod("tts")}
            title="TTS"
            desc="Text-to-speech (Orpheus, needs a large GPU)"
          />
          <MethodButton
            active={method === "decision"}
            onClick={() => chooseMethod("decision")}
            title="Decision"
            desc="System One: typed answers with probabilities"
          />
        </div>
        {method === "grpo" ? (
          <div className="mt-2 rounded-md border border-primary-soft bg-primary-tint-2 p-2.5 text-[12px]">
            <p className="text-ink">
              The model learns <strong>reasoning</strong>: it outputs{" "}
              <code>&lt;reasoning&gt;…&lt;/reasoning&gt;&lt;answer&gt;…&lt;/answer&gt;</code>, rewarded
              when the answer matches. Requires a dataset with question and answer columns (e.g.{" "}
              <code>openai/gsm8k</code>).
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-soft">Question column</span>
                <Input value={inputField} onChange={(e) => setInputField(e.target.value)} placeholder="question" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-soft">Answer column</span>
                <Input value={outputField} onChange={(e) => setOutputField(e.target.value)} placeholder="answer" />
              </label>
            </div>
          </div>
        ) : null}
        {method === "tts" ? (
          <div className="mt-2 rounded-md border border-primary-soft bg-primary-tint-2 p-2.5 text-[12px]">
            <p className="text-ink">
              Trains a <strong>text-to-speech</strong> model (Orpheus) to mimic a voice from an{" "}
              <code>(audio, text)</code> dataset. Requires a dataset with audio and text columns (e.g.{" "}
              <code>bosonai/EmergentTTS-Eval</code>).
            </p>
            <p className="mt-1.5 rounded bg-warning-soft px-2 py-1 text-[11px] text-warning">
              ⚠️ The base model is 3B — the official trainer asks for a large GPU (RTX 3090). On a
              ~6 GB GPU it will likely fail (out of VRAM). The setup is correct; it just needs an
              adequate GPU.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-soft">Audio column</span>
                <Input value={audioColumn} onChange={(e) => setAudioColumn(e.target.value)} placeholder="audio" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] text-ink-soft">Text column</span>
                <Input value={textColumn} onChange={(e) => setTextColumn(e.target.value)} placeholder="text_to_synthesize" />
              </label>
            </div>
          </div>
        ) : null}
        {method === "decision" ? (
          <div className="mt-2 rounded-md border border-primary-soft bg-primary-tint-2 p-2.5 text-[12px]">
            <p className="text-ink">
              Trains a <strong>decision model</strong> (System One): it reads a <code>state</code> and
              answers typed questions — <code>noul</code> (yes/no), <code>choice</code> or{" "}
              <code>score</code> — each with a <strong>calibrated probability</strong>, instead of
              writing text. Use it for routing, checks and classification.
            </p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] leading-4 text-ink-soft">
              <li>
                Dataset: JSONL rows <code>{`{state, questions, gold}`}</code>. Upload it as a{" "}
                <strong>Decision dataset</strong> in Datasets to have it validated.
              </li>
              <li>
                The result is <strong>not a chat model</strong>: it cannot be exported to Ollama or
                attached to vLLM. Qwen3.5 bases can be exported to GGUF; SEA-LION bases are served
                through the PyTorch decision server.
              </li>
              <li>
                The report compares accuracy and calibration (ECE) before and after training on a
                separate test set.
              </li>
            </ul>
          </div>
        ) : null}
      </div>

      {modelOptions.length === 0 && !loading ? (
        <p className="rounded-md bg-surface-2 px-3 py-2 text-[13px] text-ink-soft">
          No trainable base model yet. Download a <strong>non-GGUF</strong> model{" "}
          (e.g. Qwen2.5-0.5B / Llama-3.2-1B) via the picker in Interact first.
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
                title="Delete this local dataset"
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
          {decisionFromHf ? (
            <div className="mt-1.5 space-y-1.5">
              <p className="text-[11px] leading-4 text-ink-soft">
                From Hugging Face: it is downloaded and converted when you start, and training begins only
                once that has worked. A dataset that is already on this server is reused.
              </p>
              <Input
                value={hfSubset}
                onChange={(e) => setHfSubset(e.target.value)}
                placeholder="Subset (optional, e.g. all)"
                aria-label="Hugging Face subset"
              />
            </div>
          ) : null}
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
        {showAdvanced ? "− Hide" : "+ Advanced"} (LoRA, learning rate, max steps, context length)
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
            <div className="block">
              <span className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-ink">
                <label htmlFor="ft-lora-dropout">LoRA dropout</label>
                <InfoTip label="About LoRA dropout">
                  <code>0</code> (default) is fastest — Unsloth stays on its fast-patching path.
                  Raise it (e.g. <code>0.05</code>) only if evaluation shows the adapter{" "}
                  <strong>overfitting</strong>.
                </InfoTip>
              </span>
              <Input
                id="ft-lora-dropout"
                type="number"
                min={0}
                max={0.5}
                step={0.05}
                value={loraDropout}
                onChange={(e) => setLoraDropout(Number(e.target.value))}
                onBlur={() => setLoraDropout((v) => (Number.isFinite(v) && v >= 0 && v <= 0.5 ? v : 0))}
              />
            </div>
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium text-ink">
                {method === "decision" ? "Learning rate (backbone)" : "Learning rate"}
              </span>
              <Input
                type="number"
                step="0.0001"
                min={0}
                value={learningRate}
                onChange={(e) => setLearningRate(Number(e.target.value) || 0.0002)}
              />
            </label>
            <div className="block">
              <span className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-ink">
                <label htmlFor="ft-max-steps">Max steps</label>
                <InfoTip label="About max steps">
                  <code>-1</code> (default) runs the full epochs. A positive number{" "}
                  <strong>overrides epochs</strong> — use it only for a quick test.
                </InfoTip>
              </span>
              <Input
                id="ft-max-steps"
                type="text"
                inputMode="numeric"
                value={maxSteps}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  // Allow clearing or a lone "-" mid-typing; both mean the default (-1 = full epochs).
                  // A plain number input rejected "-" and snapped to 60, so -1 was untypable.
                  if (v === "" || v === "-") return setMaxSteps(-1);
                  const n = Number(v);
                  if (Number.isInteger(n) && n >= -1) setMaxSteps(n);
                }}
              />
            </div>
            <div className="block">
              <span className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-ink">
                <label htmlFor="ft-max-context">Max context length</label>
                <InfoTip label="About max context length">
                  Tokens per sample (context + question + answer). Anything longer is{" "}
                  <strong>silently truncated</strong>. RAG-style datasets need <code>4096</code>–
                  <code>8192</code>.
                </InfoTip>
              </span>
              {/* step must divide evenly from `min`, or the browser's spinner skips
                  the values people actually want (min 256 + step 512 made 2048/4096
                  unreachable). Clamping happens on blur, not on change — clamping
                  per keystroke snaps the field back the moment it's cleared, which
                  makes typing a value by hand impossible. */}
              <Input
                id="ft-max-context"
                type="number"
                min={256}
                step={256}
                value={maxSeqLength}
                onChange={(e) => setMaxSeqLength(Number(e.target.value))}
                onBlur={() => setMaxSeqLength((v) => (Number.isFinite(v) && v >= 256 ? v : 2048))}
              />
            </div>
            {method !== "decision" ? (
            <div className="block">
              <span className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-ink">
                <label htmlFor="ft-eval-steps">Eval steps</label>
                <InfoTip label="About eval steps">
                  How often the eval loss is measured, in steps. Every eval pass runs the whole
                  validation split, so a small number can cost more wall clock than the training
                  itself — measured on a 2,540-row run, one pass took <strong>112 s</strong>, so
                  evaluating every <code>5</code> steps spent 3.6 h on eval against 1.3 h of
                  training. <code>50</code> still draws a curve detailed enough to show
                  overfitting.
                </InfoTip>
              </span>
              {/* Clamped on blur, not per keystroke: clamping on change snaps the field
                  back the moment it is cleared, which makes typing a value impossible
                  (the same trap Max context length documents above). */}
              <Input
                id="ft-eval-steps"
                type="number"
                min={1}
                step={5}
                value={evalSteps}
                onChange={(e) => setEvalSteps(Number(e.target.value))}
                onBlur={() => setEvalSteps((v) => (Number.isInteger(v) && v >= 1 ? v : 50))}
              />
            </div>
            ) : null}
          </div>

          {method === "decision" ? (
            <div className="space-y-3 rounded-md border border-primary-soft p-3">
              <p className="text-[12px] font-medium text-primary">Decision model</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="block">
                  <span className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-ink">
                    <label htmlFor="ft-head-lr">Head learning rate</label>
                    <InfoTip label="About the head learning rate">
                      The decision head starts random, so it learns faster than the backbone:{" "}
                      <code>0.0003</code> against the backbone&apos;s <code>0.0001</code>.
                    </InfoTip>
                  </span>
                  <Input
                    id="ft-head-lr"
                    type="number"
                    step="0.0001"
                    min={0}
                    value={headLearningRate}
                    onChange={(e) => setHeadLearningRate(Number(e.target.value))}
                    onBlur={() => setHeadLearningRate((v) => (Number.isFinite(v) && v > 0 ? v : 0.0003))}
                  />
                </div>
                <div className="block">
                  <span className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-ink">
                    <label htmlFor="ft-head-warmup">Head warm-up steps</label>
                    <InfoTip label="About head warm-up">
                      Steps that train <strong>only the head</strong> with the backbone frozen,
                      before LoRA starts. <code>0</code> skips it. A few dozen can help a large base.
                    </InfoTip>
                  </span>
                  <Input
                    id="ft-head-warmup"
                    type="number"
                    min={0}
                    step={5}
                    value={headWarmupSteps}
                    onChange={(e) => setHeadWarmupSteps(Number(e.target.value))}
                    onBlur={() => setHeadWarmupSteps((v) => (Number.isInteger(v) && v >= 0 ? v : 0))}
                  />
                </div>
                <div className="block">
                  <span className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-ink">
                    <label htmlFor="ft-holdout">Holdout fraction</label>
                    <InfoTip label="About the holdout">
                      Share of the train rows kept out to <strong>calibrate</strong> the
                      probabilities. Without an eval file it is also the test set, which makes the
                      reported accuracy slightly optimistic.
                    </InfoTip>
                  </span>
                  <Input
                    id="ft-holdout"
                    type="number"
                    min={0.05}
                    max={0.5}
                    step={0.05}
                    value={holdoutFraction}
                    onChange={(e) => setHoldoutFraction(Number(e.target.value))}
                    onBlur={() =>
                      setHoldoutFraction((v) => (Number.isFinite(v) && v >= 0.05 && v <= 0.5 ? v : 0.1))
                    }
                  />
                </div>
                <div className="block">
                  <span className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-ink">
                    <label htmlFor="ft-grad-accum">Gradient accumulation</label>
                    <InfoTip label="About gradient accumulation">
                      Effective batch = batch size × this. The batch size itself is 4; raise this,
                      not the batch, when memory is shared with a running vLLM.
                    </InfoTip>
                  </span>
                  <Input
                    id="ft-grad-accum"
                    type="number"
                    min={1}
                    value={gradAccum}
                    onChange={(e) => setGradAccum(Number(e.target.value))}
                    onBlur={() => setGradAccum((v) => (Number.isInteger(v) && v >= 1 ? v : 4))}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={saveMerged || exportGguf}
                    disabled={exportGguf}
                    onChange={(e) => setSaveMerged(e.target.checked)}
                    className="size-4 shrink-0 accent-primary"
                  />
                  <span className="text-[11px] font-medium leading-4 text-ink">Also save merged 16-bit model</span>
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={exportGguf}
                    onChange={(e) => setExportGguf(e.target.checked)}
                    className="size-4 shrink-0 accent-primary"
                  />
                  <span className="text-[11px] font-medium leading-4 text-ink">Export GGUF (Qwen3.5 only)</span>
                </label>
                <InfoTip label="About the exports">
                  The adapter and head are always saved (small). The merged model is a full copy
                  (about 1.7 GB for 0.8B, 16 GB for 8B). GGUF works for <strong>Qwen3.5</strong>{" "}
                  bases only; on others the export is skipped and the report says so — the training
                  itself is never failed by an export.
                </InfoTip>
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-1.5 rounded-md bg-surface-2 px-3 py-2">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={loadIn4bit}
                onChange={(e) => setLoadIn4bit(e.target.checked)}
                className="size-4 shrink-0 accent-primary"
              />
              <span className="text-[11px] font-medium leading-4 text-ink">
                Load model in 4-bit (QLoRA)
              </span>
            </label>
            <InfoTip label="About 4-bit (QLoRA)">
              Saves memory on small GPUs. <strong>Leave it off on GB10</strong>: 128 GB of unified
              memory makes it unnecessary, and 4-bit kernels are reported to stall on sm_121.
            </InfoTip>
          </div>

          <p className="flex items-center gap-1.5 rounded-md bg-surface-2 px-3 py-2 text-[11px] leading-4 text-ink-soft">
            <Link href="/settings" className="font-medium text-primary underline underline-offset-2 hover:opacity-80">
              Set your Hugging Face token in Settings
            </Link>
            <InfoTip label="About gated models">
              Needed for <strong>gated</strong> models (Llama/Gemma). Saved once, it is reused across
              all fine-tunes and downloads.
            </InfoTip>
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="mt-3 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
          {error}
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
          {submitting ? (decisionFromHf ? "Downloading dataset, then starting…" : "Starting…") : method === "decision" ? "Start decision training" : "Start fine-tune"}
        </Button>
        <InfoTip label="About the run">
          Runs on the GPU. A small model with a small dataset finishes fastest.
        </InfoTip>
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

