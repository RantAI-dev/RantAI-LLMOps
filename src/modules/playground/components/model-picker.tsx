"use client";

import { Check, ChevronDown, Download, Loader2, Search, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { CatalogModel } from "@/lib/models-catalog";
import { useModelCatalog } from "@/modules/playground/hooks/use-model-catalog";
import { cn } from "@/lib/utils";

/**
 * Unsloth-style model picker. The trigger shows the live model; the panel lets
 * you search, switch between Downloaded models (load on click) and Recommended
 * ones (download then load) — all backed by Transformer Lab via the BFF.
 */
export function ModelPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (servedModel: string) => void;
}) {
  const { catalog, loading, busy, error, load, downloadAndLoad, exportModel, deleteFineTuned } =
    useModelCatalog(onChange);
  // Downloads/exports are long and have no pollable % from TL — show elapsed
  // time so a slow op clearly reads as "working", not frozen.
  const elapsed = useElapsed(busy ? `${busy.id}:${busy.action}` : null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"hub" | "finetuned">("hub");
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  // Chat is served by Ollama, so the picker lists Ollama models (the `servable`
  // namespace), NOT the TL registry (`downloaded`, used for training).
  const downloaded = useMemo(
    () => catalog.servable.filter((m) => match(m, q)),
    [catalog.servable, q]
  );
  const recommended = useMemo(
    () => catalog.ollamaRecommended.filter((m) => !m.downloaded && match(m, q)),
    [catalog.ollamaRecommended, q]
  );

  const label = value || catalog.loaded || "Select model";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex max-w-[320px] items-center gap-1.5 rounded-md px-2 py-1 text-sm font-semibold text-primary outline-none hover:bg-surface-2"
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="size-4 shrink-0 text-ink-soft" aria-hidden />
      </button>

      {open ? (
        <div className="absolute left-0 z-50 mt-1 w-[380px] overflow-hidden rounded-xl border border-input bg-background shadow-lg">
          {/* Tabs */}
          <div className="flex gap-1 border-b border-border p-1.5">
            <TabButton active={tab === "hub"} onClick={() => setTab("hub")}>
              Hub models
            </TabButton>
            <TabButton active={tab === "finetuned"} onClick={() => setTab("finetuned")}>
              Fine-tuned
            </TabButton>
          </div>

          {tab === "finetuned" ? (
            <div className="max-h-[380px] overflow-y-auto py-1.5">
              {catalog.fineTuned.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px] text-ink-soft">
                  <Sparkles className="mx-auto mb-2 size-5 text-ink-soft" aria-hidden />
                  Belum ada model fine-tuned.
                  <br />
                  Latih satu di menu <strong>Fine-tune</strong> — hasilnya muncul di sini.
                </div>
              ) : (
                <Section title="Your models">
                  {catalog.fineTuned.map((ft) => {
                    const busyHere = busy?.id === ft.fusedModelId ? busy.action : null;
                    const ggufModel = ft.loadModelId
                      ? catalog.downloaded.find((m) => m.id === ft.loadModelId)
                      : undefined;
                    const active = ggufModel && matchesLoaded(ggufModel, catalog.loaded);
                    const onClick = () => {
                      if (ft.ready && ggufModel) {
                        load(ggufModel).then(() => setOpen(false));
                      } else {
                        exportModel(ft.fusedModelId);
                      }
                    };
                    return (
                      <div
                        key={ft.fusedModelId}
                        className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2"
                      >
                        <button
                          type="button"
                          disabled={busyHere !== null}
                          onClick={onClick}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:opacity-60"
                        >
                          <div className="grid size-4 shrink-0 place-items-center">
                            {busyHere && busyHere !== "delete" ? (
                              <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                            ) : active ? (
                              <Check className="size-4 text-primary" aria-hidden />
                            ) : (
                              <Sparkles className="size-4 text-primary" aria-hidden />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm text-ink">{ft.name}</div>
                            <div className="truncate text-[11px] text-ink-soft">
                              on {ft.baseModelName}
                            </div>
                          </div>
                          <span className="shrink-0 text-[11px] tabular-nums text-ink-soft">
                            {busyHere === "export"
                              ? `Exporting… ${elapsed}s`
                              : busyHere === "load"
                                ? "Loading…"
                                : ft.ready
                                  ? "Use"
                                  : "Export to use"}
                          </span>
                        </button>
                        <button
                          type="button"
                          disabled={busyHere !== null}
                          onClick={() => deleteFineTuned(ft.fusedModelId, ft.loadModelId)}
                          aria-label="Delete fine-tuned model"
                          className="grid size-6 shrink-0 place-items-center rounded text-ink-soft opacity-0 hover:text-danger group-hover:opacity-100 disabled:opacity-60"
                        >
                          {busyHere === "delete" ? (
                            <Loader2 className="size-3.5 animate-spin" aria-hidden />
                          ) : (
                            <Trash2 className="size-3.5" aria-hidden />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </Section>
              )}
            </div>
          ) : (
            <>
              {/* Search */}
              <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                <Search className="size-4 shrink-0 text-ink-soft" aria-hidden />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search models…"
                  className="w-full bg-transparent text-sm outline-none placeholder:text-ink-soft"
                  autoFocus
                />
              </div>

              {error ? (
                <div className="border-b border-danger-border bg-danger-soft px-3 py-2 text-[12px] text-danger">
                  {error}
                </div>
              ) : null}

              <div className="max-h-[340px] overflow-y-auto py-1.5">
                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-[13px] text-ink-soft">
                    <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
                  </div>
                ) : (
                  <>
                    <Section title="Downloaded">
                      {downloaded.length === 0 ? (
                        <Empty>Belum ada model lokal.</Empty>
                      ) : (
                        downloaded.map((m) => (
                          <ModelRow
                            key={m.id}
                            model={m}
                            active={matchesLoaded(m, catalog.loaded)}
                            busy={busy?.id === m.id ? busy.action : null}
                            onClick={() => {
                              load(m).then(() => setOpen(false));
                            }}
                          />
                        ))
                      )}
                    </Section>

                    <Section title="Recommended" hint="muat di GPU ≤ 8 GB">
                      {recommended.length === 0 ? (
                        <Empty>Semua rekomendasi sudah ke-download.</Empty>
                      ) : (
                        recommended.map((m) => (
                          <ModelRow
                            key={m.id}
                            model={m}
                            busy={busy?.id === m.id ? busy.action : null}
                            elapsed={elapsed}
                            downloadable
                            onClick={() => {
                              downloadAndLoad(m).then(() => setOpen(false));
                            }}
                          />
                        ))
                      )}
                    </Section>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
        active ? "bg-surface-2 text-primary" : "text-ink-soft hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-1.5 pb-1">
      <div className="flex items-center gap-2 px-2 pt-1.5 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
          {title}
        </span>
        {hint ? <span className="text-[11px] text-ink-soft">· {hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-1.5 text-[12px] text-ink-soft">{children}</div>;
}

function ModelRow({
  model,
  active,
  busy,
  elapsed = 0,
  downloadable,
  onClick,
}: {
  model: CatalogModel;
  active?: boolean;
  busy: "load" | "download" | "export" | "delete" | null;
  elapsed?: number;
  downloadable?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy !== null}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2 disabled:opacity-60"
    >
      <div className="grid size-4 shrink-0 place-items-center">
        {busy ? (
          <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
        ) : active ? (
          <Check className="size-4 text-primary" aria-hidden />
        ) : downloadable ? (
          <Download className="size-4 text-ink-soft" aria-hidden />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-ink">{model.name}</div>
        <div className="truncate text-[11px] text-ink-soft">{model.id}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {model.isGguf ? (
          <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-soft">
            GGUF
          </span>
        ) : null}
        <span className="text-[11px] tabular-nums text-ink-soft">
          {busy === "download"
            ? `Downloading… ${elapsed}s`
            : busy === "load"
              ? "Loading…"
              : formatSize(model.sizeMb)}
        </span>
      </div>
    </button>
  );
}

/** Seconds since `key` became non-null; resets when `key` changes (or clears). */
function useElapsed(key: string | null): number {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!key) return;
    const start = Date.now();
    const t = setInterval(() => setSec(Math.floor((Date.now() - start) / 1000)), 500);
    return () => clearInterval(t);
  }, [key]);
  return key ? sec : 0;
}

function match(m: CatalogModel, q: string): boolean {
  if (!q) return true;
  return `${m.name} ${m.id}`.toLowerCase().includes(q);
}

/** Does this catalog model correspond to the currently-served model name? */
function matchesLoaded(m: CatalogModel, loaded: string | null): boolean {
  if (!loaded) return false;
  if (m.localPath && m.localPath.toLowerCase().endsWith(loaded.toLowerCase())) return true;
  const last = m.id.split("/").pop() ?? m.id;
  return last.toLowerCase() === loaded.toLowerCase();
}

function formatSize(mb: number | null): string {
  if (mb == null || mb <= 0) return "";
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
