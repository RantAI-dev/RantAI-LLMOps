"use client";

import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";

import { Input } from "@/components/ui/input";

type HfHit = { id: string; downloads: number; params?: number | null };
type Kind = "model" | "dataset";

/** A quick-pick entry shown when the box is empty (curated + local items). */
export type Preset = { id: string; label: string; params?: number | null; local?: boolean };

const CONFIG: Record<
  Kind,
  { url: (q: string) => string; key: "models" | "datasets"; placeholder: string; hint: string }
> = {
  model: {
    url: (q) => `/api/hub/base-models?q=${encodeURIComponent(q)}`,
    key: "models",
    placeholder: "Ketik untuk cari model, atau pilih dari daftar…",
    hint: "Model trainable (non-GGUF), ditarik otomatis dari HF saat training.",
  },
  dataset: {
    url: (q) => `/api/hub/datasets?search=${encodeURIComponent(q)}`,
    key: "datasets",
    placeholder: "Ketik untuk cari dataset, atau pilih dari daftar…",
    hint: "Dataset lokal/upload di atas; ketik untuk cari di Hugging Face.",
  },
};

/**
 * Combobox for a base model or dataset. Search-first: it's a single input that
 * shows a curated/local shortlist (`presets`) when empty and switches to live
 * Hugging Face search as you type. Picking sets an HF (or local) id; the trainer
 * pulls remote ids at run time — no pre-download — so any public repo is usable.
 */
export function HfSearch({
  kind,
  selected,
  onPick,
  presets = [],
  initialQuery = "",
}: {
  kind: Kind;
  selected: string;
  onPick: (id: string) => void;
  presets?: Preset[];
  initialQuery?: string;
}) {
  const cfg = CONFIG[kind];
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState<HfHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);

  // Debounced HF search (>= 2 chars). All state updates happen inside the timeout
  // callback (never synchronously in the effect body) so React doesn't flag
  // cascading renders.
  useEffect(() => {
    const query = q.trim();
    const t = setTimeout(() => {
      if (query.length < 2) {
        setResults([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      fetch(cfg.url(query), { cache: "no-store" })
        .then((r) => r.json() as Promise<Record<string, HfHit[] | undefined>>)
        .then((d) => setResults(Array.isArray(d[cfg.key]) ? (d[cfg.key] as HfHit[]) : []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [q, cfg]);

  const typed = q.trim();
  const searching = typed.length >= 2;
  // Let the user use an exact "owner/name" they typed even if search didn't surface it.
  const exact = searching && typed.includes("/") && !results.some((m) => m.id === typed) ? typed : null;
  const open =
    focused && (searching ? loading || results.length > 0 || !!exact : presets.length > 0);

  const pick = (id: string) => {
    onPick(id);
    setQ("");
    setFocused(false);
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-soft"
          aria-hidden
        />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setFocused(true)}
          // Delay close so a click on an option registers first.
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder={cfg.placeholder}
          className="pl-8"
        />
      </div>
      {selected ? (
        <span className="mt-1 block truncate text-[11px] font-medium text-primary">✓ {selected}</span>
      ) : (
        <span className="mt-1 block text-[11px] text-ink-soft">{cfg.hint}</span>
      )}
      {open ? (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-input bg-background shadow-lg">
          {searching ? (
            loading ? (
              <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-ink-soft">
                <Loader2 className="size-3.5 animate-spin" aria-hidden /> Mencari di Hugging Face…
              </div>
            ) : results.length === 0 && !exact ? (
              <div className="px-3 py-2 text-[12px] text-ink-soft">Ngga ada hasil.</div>
            ) : (
              <>
                {exact ? (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(exact)}
                    className="flex w-full items-center gap-2 border-b border-border px-3 py-1.5 text-left text-[13px] text-primary hover:bg-surface-2"
                  >
                    <span className="truncate">Pakai persis: {exact}</span>
                  </button>
                ) : null}
                {results.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(m.id)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-surface-2"
                  >
                    <span className="truncate text-ink">{m.id}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-ink-soft">
                      {m.params ? `${fmtSize(m.params)} · ` : ""}
                      {fmtDownloads(m.downloads)}
                    </span>
                  </button>
                ))}
              </>
            )
          ) : (
            // Empty query → curated + local shortlist.
            presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p.id)}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-surface-2"
              >
                <span className="truncate text-ink">{p.label}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-soft">
                  {p.local ? (
                    <span className="rounded bg-success-soft px-1 py-0.5 font-medium text-success">
                      lokal
                    </span>
                  ) : null}
                  {p.params ? <span className="tabular-nums">{fmtSize(p.params)}</span> : null}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function fmtDownloads(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M ↓`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k ↓`;
  return `${n} ↓`;
}

/** Approx download size from parameter count (safetensors fp16/bf16 ≈ 2 bytes/param). */
function fmtSize(params: number): string {
  const bytes = params * 2;
  if (bytes >= 1e9) return `≈${(bytes / 1e9).toFixed(1)} GB`;
  return `≈${Math.round(bytes / 1e6)} MB`;
}
