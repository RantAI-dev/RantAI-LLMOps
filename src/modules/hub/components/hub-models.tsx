"use client";

import { useState } from "react";
import { Download, ExternalLink, Heart, Loader2, Lock, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pullModelWithProgress } from "@/lib/pull-progress";
import type { HubModel, HubQuant } from "@/lib/hf-hub";
import { useHubModels } from "@/modules/hub/hooks/use-hub-models";
import { compact } from "@/modules/hub/lib/format";
import { cn } from "@/lib/utils";

const TASKS = [
  { value: "", label: "Semua task" },
  { value: "text-generation", label: "Text Generation" },
  { value: "text2text-generation", label: "Text2Text" },
  { value: "feature-extraction", label: "Embeddings" },
];

const SORTS = [
  { value: "trending", label: "Trending" },
  { value: "downloads", label: "Downloads" },
  { value: "likes", label: "Likes" },
  { value: "modified", label: "Updated" },
];

export function HubModels() {
  const [search, setSearch] = useState("");
  const [task, setTask] = useState("text-generation");
  const [sort, setSort] = useState("trending");
  const { models, loading, error } = useHubModels(search, task, sort);

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* Filter rail */}
      <aside className="shrink-0 space-y-4 lg:w-48">
        <FilterGroup label="Sort">
          {SORTS.map((s) => (
            <FilterPill key={s.value} active={sort === s.value} onClick={() => setSort(s.value)}>
              {s.label}
            </FilterPill>
          ))}
        </FilterGroup>
        <FilterGroup label="Task">
          {TASKS.map((t) => (
            <FilterPill key={t.value} active={task === t.value} onClick={() => setTask(t.value)}>
              {t.label}
            </FilterPill>
          ))}
        </FilterGroup>
        <p className="text-[11px] leading-4 text-ink-faint">
          Cuma model <span className="font-medium">GGUF</span> yang ditampilkan — itu yang bisa
          dijalankan Ollama untuk inference.
        </p>
      </aside>

      {/* Results */}
      <div className="min-w-0 flex-1 space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari model GGUF di Hugging Face… (mis. llama, qwen)"
            className="pl-9"
          />
        </div>

        {error ? (
          <div className="rounded-lg border border-dashed border-danger/40 bg-danger/5 p-4 text-sm text-danger">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-soft">
            <Loader2 className="size-4 animate-spin" /> Memuat dari Hugging Face…
          </div>
        ) : models.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-ink-soft">
            Tidak ada model GGUF yang cocok.
          </div>
        ) : (
          <div className="space-y-2">
            {models.map((m) => (
              <HubModelCard key={m.id} model={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HubModelCard({ model }: { model: HubModel }) {
  const [open, setOpen] = useState(false);
  const [quants, setQuants] = useState<HubQuant[] | null>(null);
  const [quant, setQuant] = useState("");
  const [loadingQuants, setLoadingQuants] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [percent, setPercent] = useState<number | null>(null);

  async function openDownload() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (quants) return;
    setLoadingQuants(true);
    try {
      const res = await fetch(`/api/hub/model?repo=${encodeURIComponent(model.id)}`);
      const data = (await res.json()) as { quants?: HubQuant[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Gagal");
      const list = data.quants ?? [];
      setQuants(list);
      // Prefer a balanced default quant if present.
      const preferred = ["Q4_K_M", "Q4_0", "Q5_K_M", "Q8_0"].find((q) =>
        list.some((x) => x.quant === q)
      );
      setQuant(preferred ?? list[0]?.quant ?? "");
    } catch {
      setQuants([]);
    } finally {
      setLoadingQuants(false);
    }
  }

  async function pull() {
    if (!quant) return;
    setPulling(true);
    setPercent(null);
    try {
      await pullModelWithProgress(`hf.co/${model.id}:${quant}`, (p) => setPercent(p));
      toast.success(`Downloaded — pilih di picker Chat untuk dipakai`);
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download gagal");
    } finally {
      setPulling(false);
      setPercent(null);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium text-primary">{model.id}</span>
            {model.gated ? (
              <Lock className="size-3.5 shrink-0 text-warning" aria-label="gated" />
            ) : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-soft">
            {model.task ? <span>{model.task}</span> : null}
            <span className="inline-flex items-center gap-0.5">
              <Download className="size-3" /> {compact(model.downloads)}
            </span>
            <span className="inline-flex items-center gap-0.5">
              <Heart className="size-3" /> {compact(model.likes)}
            </span>
          </div>
        </div>
        <a
          href={`https://huggingface.co/${model.id}`}
          target="_blank"
          rel="noreferrer"
          className="grid size-8 place-items-center rounded-md text-ink-soft hover:bg-surface-2"
          title="Buka di Hugging Face"
        >
          <ExternalLink className="size-4" />
        </a>
        <Button type="button" size="sm" variant={open ? "outline" : "default"} onClick={openDownload}>
          <Download className="size-4" /> Download
        </Button>
      </div>

      {open ? (
        <div className="space-y-2 border-t border-border px-3 py-2.5">
          {loadingQuants ? (
            <p className="flex items-center gap-2 text-[13px] text-ink-soft">
              <Loader2 className="size-3.5 animate-spin" /> Membaca quant…
            </p>
          ) : quants && quants.length === 0 ? (
            <p className="text-[13px] text-ink-soft">
              Repo ini tidak punya file .gguf — coba repo GGUF lain.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[12px] text-ink-soft">Quant:</label>
                <select
                  value={quant}
                  onChange={(e) => setQuant(e.target.value)}
                  disabled={pulling}
                  className="h-8 rounded-md border border-input bg-background px-2 text-[13px]"
                >
                  {(quants ?? []).map((q) => (
                    <option key={q.quant} value={q.quant}>
                      {q.quant}
                    </option>
                  ))}
                </select>
                <Button type="button" size="sm" onClick={pull} disabled={pulling || !quant}>
                  {pulling ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
                  {pulling ? (percent != null ? `${percent}%` : "Pulling…") : `Pull hf.co/…:${quant}`}
                </Button>
                {model.gated ? (
                  <span className="text-[11px] text-warning">
                    gated — butuh HF_TOKEN di server
                  </span>
                ) : null}
              </div>
              {pulling && percent != null ? (
                <div className="h-1 overflow-hidden rounded bg-surface-2">
                  <div
                    className={cn("h-full bg-primary transition-[width] duration-300")}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-semibold tracking-wide text-ink-soft uppercase">{label}</p>
      <div className="flex flex-wrap gap-1.5 lg:flex-col lg:items-start">{children}</div>
    </div>
  );
}

function FilterPill({
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
        "rounded-md px-2 py-1 text-left text-[13px] transition-colors",
        active ? "bg-primary-soft font-medium text-primary" : "text-ink hover:bg-surface-2"
      )}
    >
      {children}
    </button>
  );
}
