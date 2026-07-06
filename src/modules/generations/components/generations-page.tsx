"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Columns2, Loader2, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { cn } from "@/lib/utils";
import { useGenerations, type GenTarget } from "@/modules/generations/hooks/use-generations";

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

type CatalogModel = { id: string; name: string; isGguf: boolean };
type FineTuned = { name: string; fusedModelId: string; ready: boolean; loadModelId: string | null };
// `servable` = the Ollama models we can actually run (base + our fine-tune
// exports). `downloaded` is TL's safetensors registry, which stays empty when
// models are pulled into Ollama via Hub — so base models come from `servable`.
type Catalog = { servable?: CatalogModel[]; fineTuned?: FineTuned[] };

const DEFAULT_PROMPTS = ["Jelaskan secara singkat tentang dirimu.", "Apa yang kamu pelajari?"].join(
  "\n"
);

const PHASE_LABEL: Record<string, string> = {
  "loading-base": "Memuat base…",
  base: "Base menjawab",
  "loading-ft": "Memuat fine-tuned…",
  "fine-tuned": "Fine-tuned menjawab",
};

/** Output comparison: same prompts → base vs fine-tuned model, side by side. */
export function GenerationsPage() {
  const { running, progress, rows, error, runCompare } = useGenerations();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [baseId, setBaseId] = useState("");
  // Select by fusedModelId (train job id) — names aren't unique (repeated
  // fine-tune runs share a name), so keying/selecting by name is ambiguous.
  const [ftId, setFtId] = useState("");
  const [promptText, setPromptText] = useState(DEFAULT_PROMPTS);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/models/catalog", { cache: "no-store" })
      .then((r) => r.json() as Promise<Catalog>)
      .then((c) => {
        if (!cancelled) setCatalog(c);
      })
      .catch(() => {
        if (!cancelled) setCatalog({ servable: [], fineTuned: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Base = servable Ollama models that aren't our own fine-tune exports (nqr-*).
  const baseModels = useMemo(
    () => (catalog?.servable ?? []).filter((m) => !m.id.startsWith("nqr-")),
    [catalog]
  );
  const fineTuned = catalog?.fineTuned ?? [];
  const selectedFt = fineTuned.find((f) => f.fusedModelId === ftId);

  // Preselect from Model Registry's "Compare" action once the catalog is loaded:
  // `?base=<ollama-id>` fills the base slot; `?ft=<ollama-tag>` maps to the
  // matching fine-tune's fusedModelId. Applied once, then the params are stripped.
  const preselectDone = useRef(false);
  useEffect(() => {
    if (preselectDone.current || !catalog) return;
    preselectDone.current = true;
    const params = new URLSearchParams(window.location.search);
    const baseParam = params.get("base");
    const ftParam = params.get("ft");
    if (!baseParam && !ftParam) return;
    const strip = (s: string) => s.replace(/:latest$/, "");
    const t = setTimeout(() => {
      if (baseParam) setBaseId(baseParam);
      if (ftParam) {
        const match = (catalog.fineTuned ?? []).find(
          (f) => f.loadModelId && strip(f.loadModelId) === strip(ftParam)
        );
        if (match) setFtId(match.fusedModelId);
      }
      params.delete("base");
      params.delete("ft");
      const qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }, 0);
    return () => clearTimeout(t);
  }, [catalog]);
  // Names repeat across runs — disambiguate those options with a short id.
  const dupeNames = new Set(
    fineTuned.filter((f, i, a) => a.findIndex((x) => x.name === f.name) !== i).map((f) => f.name)
  );

  const prompts = promptText.split("\n").map((s) => s.trim()).filter(Boolean);
  const canRun = baseId && selectedFt && prompts.length > 0 && !running;

  const handleRun = () => {
    if (!selectedFt) return;
    const base: GenTarget = { modelId: baseId, label: "base" };
    // Load the GGUF export if present, else the fused safetensors directly.
    const ft: GenTarget = {
      modelId: selectedFt.loadModelId ?? selectedFt.fusedModelId,
      label: "fine-tuned",
    };
    runCompare({ base, ft, prompts, temperature: 0.3 });
  };

  if (!catalog) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <LoadingState label="Loading models…" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold text-primary">
          <Columns2 className="size-5" /> Output comparison
        </h1>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          Tanya prompt yang sama ke model <strong>base</strong> dan hasil <strong>fine-tune</strong>,
          lihat jawabannya berdampingan. Bukti kualitatif efek fine-tune (bukan cuma skor).
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        {fineTuned.length === 0 ? (
          <p className="rounded-md bg-surface-2 px-3 py-2 text-[13px] text-ink-soft">
            Belum ada model fine-tuned. Latih satu di menu <strong>Fine-tune</strong> dulu — hasilnya
            muncul di sini.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-ink">Base model</span>
                <select className={selectClass} value={baseId} onChange={(e) => setBaseId(e.target.value)}>
                  <option value="">Pilih base…</option>
                  {baseModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.isGguf ? " (GGUF)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[13px] font-medium text-ink">Fine-tuned model</span>
                <select className={selectClass} value={ftId} onChange={(e) => setFtId(e.target.value)}>
                  <option value="">Pilih fine-tuned…</option>
                  {fineTuned.map((f) => (
                    <option key={f.fusedModelId} value={f.fusedModelId}>
                      {f.name}
                      {dupeNames.has(f.name) ? ` · ${f.fusedModelId.slice(0, 8)}` : ""}
                      {f.ready ? " (GGUF)" : " (safetensors)"}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="mt-3 block">
              <span className="mb-1 block text-[13px] font-medium text-ink">
                Prompts — satu per baris ({prompts.length})
              </span>
              <textarea
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                rows={4}
                className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={"Prompt pertama\nPrompt kedua"}
              />
            </label>

            {progress ? (
              <p className="mt-3 inline-flex items-center gap-2 text-[12px] text-ink-soft">
                <Loader2 className="size-3.5 animate-spin" />
                {PHASE_LABEL[progress.phase]}
                {progress.phase === "base" || progress.phase === "fine-tuned"
                  ? ` (${progress.index + 1}/${progress.total})`
                  : ""}
                …
              </p>
            ) : null}
            {error ? (
              <p className="mt-2 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
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
                    <Play className="size-4" /> Bandingkan
                  </>
                )}
              </Button>
              <p className="text-[12px] text-ink-soft">
                Jalan <strong>satu per satu</strong> (load base → tanya → load fine-tuned → tanya).
                Bisa beberapa menit.
              </p>
            </div>
          </>
        )}
      </div>

      {rows.length > 0 ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-primary">Hasil</h2>
          {rows.map((row, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-border bg-surface">
              <div className="border-b border-border bg-surface-2 px-4 py-2 text-[13px] font-medium text-ink">
                {row.prompt}
              </div>
              <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <Answer label="Base" tone="muted" text={row.base} />
                <Answer label="Fine-tuned" tone="primary" text={row.fineTuned} />
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Answer({ label, tone, text }: { label: string; tone: "muted" | "primary"; text: string }) {
  return (
    <div className="min-w-0 p-4">
      <p
        className={cn(
          "mb-1.5 text-[11px] font-semibold uppercase tracking-wide",
          tone === "primary" ? "text-primary" : "text-ink-soft"
        )}
      >
        {label}
      </p>
      <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-ink">
        {text || <span className="text-ink-soft">(kosong)</span>}
      </p>
    </div>
  );
}
