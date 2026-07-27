"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Heart,
  Loader2,
  Lock,
  PackageSearch,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FilterDropdown } from "@/components/ui/filter-dropdown";
import { FilterToolbar } from "@/components/ui/filter-toolbar";
import { LoadingState } from "@/components/ui/loading-state";
import { pullModelWithProgress } from "@/lib/pull-progress";
import type { HubModel, HubQuant } from "@/lib/hf-hub";
import {
  HubDownloaded,
  type DownloadedSort,
} from "@/modules/hub/components/hub-downloaded";
import { useDownloadedModels } from "@/modules/hub/hooks/use-downloaded";
import {
  useHubModels,
  type HubModelFormat,
} from "@/modules/hub/hooks/use-hub-models";
import { compact } from "@/modules/hub/lib/format";
import { cn } from "@/lib/utils";

type DownloadStatus = "all" | "downloaded" | "explore";

const TASKS = [
  { value: "all", label: "Semua task", hint: "ALL" },
  { value: "text-generation", label: "Text Generation", hint: "GEN" },
  { value: "text2text-generation", label: "Text2Text", hint: "T2T" },
  { value: "feature-extraction", label: "Embeddings", hint: "EMB" },
];

const EXPLORE_SORTS = [
  { value: "trending", label: "Trending", hint: "HOT" },
  { value: "downloads", label: "Downloads", hint: "DL" },
  { value: "likes", label: "Likes", hint: "♥" },
  { value: "modified", label: "Updated", hint: "NEW" },
];

const DOWNLOADED_SORTS = [
  { value: "name", label: "Nama A–Z", hint: "A–Z" },
  { value: "size-desc", label: "Ukuran terbesar", hint: "↓" },
  { value: "size-asc", label: "Ukuran terkecil", hint: "↑" },
];

const FORMATS = [
  { value: "gguf", label: "GGUF", hint: "Chat" },
  { value: "safetensors", label: "Safetensors", hint: "Fine-tune" },
  { value: "all", label: "Semua format", hint: "ALL" },
];

export function HubModels() {
  const [search, setSearch] = useState("");
  const [task, setTask] = useState("all");
  const [sort, setSort] = useState("trending");
  const [downloadedSort, setDownloadedSort] = useState<DownloadedSort>("name");
  const [format, setFormat] = useState<HubModelFormat>("gguf");
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus>("all");
  const showingDownloaded = downloadStatus === "downloaded";
  const { models, loading, error, reload: reloadHub } = useHubModels(
    search,
    task === "all" ? "" : task,
    sort,
    format
  );
  const downloaded = useDownloadedModels();
  const downloadedIds = useMemo(
    () => new Set(downloaded.models.map((model) => model.id.toLowerCase())),
    [downloaded.models]
  );

  function modelIsDownloaded(modelId: string) {
    const repo = modelId.toLowerCase();
    for (const id of downloadedIds) {
      if (id === repo || id.startsWith(`hf.co/${repo}:`) || id.startsWith(`${repo}:`)) {
        return true;
      }
    }
    return false;
  }

  const downloadedCount = useMemo(() => {
    return models.filter((model) => {
      const repo = model.id.toLowerCase();
      for (const id of downloadedIds) {
        if (id === repo || id.startsWith(`hf.co/${repo}:`) || id.startsWith(`${repo}:`)) {
          return true;
        }
      }
      return false;
    }).length;
  }, [models, downloadedIds]);

  const visibleModels = useMemo(() => {
    if (downloadStatus === "all") return models;
    if (downloadStatus === "downloaded") {
      return models.filter((model) => {
        const repo = model.id.toLowerCase();
        for (const id of downloadedIds) {
          if (id === repo || id.startsWith(`hf.co/${repo}:`) || id.startsWith(`${repo}:`)) {
            return true;
          }
        }
        return false;
      });
    }
    // Explore = not yet on Ollama
    return models.filter((model) => {
      const repo = model.id.toLowerCase();
      for (const id of downloadedIds) {
        if (id === repo || id.startsWith(`hf.co/${repo}:`) || id.startsWith(`${repo}:`)) {
          return false;
        }
      }
      return true;
    });
  }, [models, downloadStatus, downloadedIds]);

  function resetFilters() {
    setSearch("");
    setTask("all");
    setSort("trending");
    setDownloadedSort("name");
    setFormat("gguf");
    setDownloadStatus("all");
  }

  return (
    <div className="space-y-4">
      <FilterToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search"
        searchAriaLabel={showingDownloaded ? "Cari model lokal" : "Cari model Hugging Face"}
        segments={[
          { value: "all", label: "All", count: models.length },
          {
            value: "downloaded",
            label: "Downloaded",
            count: downloaded.loading ? downloadedCount : downloaded.models.length,
          },
          {
            value: "explore",
            label: "Explore",
            count: Math.max(models.length - downloadedCount, 0),
          },
        ]}
        segmentValue={downloadStatus}
        onSegmentChange={(value) => setDownloadStatus(value as DownloadStatus)}
        searchAside={
          showingDownloaded ? (
            <FilterDropdown
              label="Sort"
              value={downloadedSort}
              onChange={(value) => setDownloadedSort(value as DownloadedSort)}
              options={DOWNLOADED_SORTS}
              searchPlaceholder="Type sort…"
            />
          ) : (
            <FilterDropdown
              label="Sort"
              value={sort}
              onChange={setSort}
              options={EXPLORE_SORTS}
              searchPlaceholder="Type sort…"
            />
          )
        }
      >
        {!showingDownloaded ? (
          <>
            <FilterDropdown
              label="Format"
              value={format}
              onChange={(value) => setFormat(value as HubModelFormat)}
              options={FORMATS}
              searchPlaceholder="Type format…"
            />
            <FilterDropdown
              label="Task"
              value={task}
              onChange={setTask}
              options={TASKS}
              searchPlaceholder="Type task…"
            />
          </>
        ) : null}
      </FilterToolbar>

      {showingDownloaded ? (
        <HubDownloaded
          {...downloaded}
          search={search}
          sort={downloadedSort}
          onClearSearch={() => setSearch("")}
        />
      ) : (
        <>
          <p className="text-[12px] leading-5 text-ink-soft">
            <span className="font-medium text-ink">GGUF</span> dapat di-download dan langsung
            dipakai untuk chat lewat Ollama.{" "}
            <span className="font-medium text-ink">Safetensors</span> adalah base model untuk
            fine-tune, bukan model chat siap pakai.
          </p>

          {error ? (
            <ErrorState title="Model gagal dimuat" description={error} onRetry={reloadHub} />
          ) : loading ? (
            <LoadingState label="Memuat model dari Hugging Face…" />
          ) : visibleModels.length === 0 ? (
            <EmptyState
              icon={PackageSearch}
              title="Model tidak ditemukan"
              description="Coba kata kunci lain atau reset filter."
              action={
                <Button type="button" size="sm" variant="outline" onClick={resetFilters}>
                  Reset filter
                </Button>
              }
            />
          ) : (
            <div className="space-y-2">
              {visibleModels.map((model) => (
                <HubModelCard
                  key={model.id}
                  model={model}
                  downloaded={modelIsDownloaded(model.id)}
                  onDownloaded={downloaded.reload}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FormatBadge({ format }: { format: HubModel["format"] }) {
  const gguf = format === "gguf";
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
        gguf ? "bg-primary-soft text-primary" : "bg-warning/15 text-warning"
      )}
      title={
        gguf ? "Bisa langsung di-chat (Ollama)" : "Base model fine-tune — gak bisa di-chat langsung"
      }
    >
      {gguf ? "GGUF" : "safetensors"}
    </span>
  );
}

function HubModelCard({
  model,
  downloaded,
  onDownloaded,
}: {
  model: HubModel;
  downloaded: boolean;
  onDownloaded: () => void;
}) {
  const isGguf = model.format === "gguf";
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
      onDownloaded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download gagal");
    } finally {
      setPulling(false);
      setPercent(null);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 p-3 sm:gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium text-primary">{model.id}</span>
            <FormatBadge format={model.format} />
            {model.gated ? (
              <Lock className="size-3.5 shrink-0 text-warning" aria-label="gated" />
            ) : null}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-soft">
            {model.params ? <span>{(model.params / 1e9).toFixed(1)}B</span> : null}
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
          className="grid size-8 shrink-0 place-items-center rounded-md text-ink-soft hover:bg-surface-2"
          title="Buka di Hugging Face"
        >
          <ExternalLink className="size-4" />
        </a>

        {downloaded ? (
          <span
            className="grid size-8 shrink-0 place-items-center rounded-full bg-success-soft text-success"
            title="Sudah di Ollama"
            aria-label="Sudah di-download"
          >
            <CheckCircle2 className="size-4" aria-hidden />
          </span>
        ) : null}

        {isGguf ? (
          <Button
            type="button"
            size="icon-sm"
            variant={downloaded ? "outline" : open ? "outline" : "default"}
            onClick={openDownload}
            title={downloaded ? "Download ulang / quant lain" : "Download ke Ollama"}
            aria-label={downloaded ? "Download ulang" : "Download"}
          >
            {pulling ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
          </Button>
        ) : (
          <Link
            href={`/finetune?base=${encodeURIComponent(model.id)}`}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-[13px] font-medium text-ink hover:bg-surface-2"
            title="Pakai sebagai base model fine-tune"
          >
            <Sparkles className="size-3.5" /> Fine-tune
          </Link>
        )}
      </div>

      {isGguf && open ? (
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
                  {pulling
                    ? percent != null
                      ? `${percent}%`
                      : "Pulling…"
                    : `Pull hf.co/…:${quant}`}
                </Button>
                {model.gated ? (
                  <span className="text-[11px] text-warning">gated — butuh HF_TOKEN di server</span>
                ) : null}
              </div>
              {pulling && percent != null ? (
                <div className="h-1 overflow-hidden rounded bg-surface-2">
                  <div
                    className="h-full bg-primary transition-[width] duration-300"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {!isGguf ? (
        <div className="border-t border-border px-3 py-2 text-[12px] text-ink-soft">
          Format <span className="font-medium">safetensors</span> — gak bisa di-chat langsung. Pakai
          buat{" "}
          <Link
            href={`/finetune?base=${encodeURIComponent(model.id)}`}
            className="text-primary underline underline-offset-2"
          >
            fine-tune
          </Link>
          , atau cari versi GGUF-nya kalau mau langsung chat.
        </div>
      ) : null}
    </div>
  );
}
