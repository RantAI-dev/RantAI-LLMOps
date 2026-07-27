"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, HardDrive, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { LoadingState } from "@/components/ui/loading-state";
import type { CatalogModel } from "@/lib/models-catalog";
import { formatSize } from "@/modules/hub/lib/format";
import { cn } from "@/lib/utils";

export type DownloadedSort = "name" | "size-desc" | "size-asc";

type HubDownloadedProps = {
  models: CatalogModel[];
  loading: boolean;
  deleting: string | null;
  remove: (id: string) => Promise<void>;
  reload: () => void;
  search: string;
  sort: DownloadedSort;
  onClearSearch?: () => void;
};

export function HubDownloaded({
  models,
  loading,
  deleting,
  remove,
  reload,
  search,
  sort,
  onClearSearch,
}: HubDownloadedProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const totalMb = models.reduce((sum, m) => sum + (m.sizeMb ?? 0), 0);
  const visibleModels = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...models]
      .filter((model) => !query || `${model.name} ${model.id}`.toLowerCase().includes(query))
      .sort((a, b) => {
        if (sort === "size-desc") return (b.sizeMb ?? -1) - (a.sizeMb ?? -1);
        if (sort === "size-asc") {
          return (a.sizeMb ?? Number.MAX_VALUE) - (b.sizeMb ?? Number.MAX_VALUE);
        }
        return a.name.localeCompare(b.name);
      });
  }, [models, search, sort]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] text-ink-soft">
          {loading ? "Memuat…" : `${models.length} model · total ${formatSize(totalMb)}`}
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={() => reload()} title="Refresh">
          <RefreshCw className="size-4" />
        </Button>
      </div>

      <p className="text-[12px] leading-5 text-ink-soft">
        Model yang sudah di-download (Ollama). Hapus yang tak dipakai untuk melegakan disk — bisa
        di-download lagi kapan saja lewat Explore.
      </p>

      {loading ? (
        <LoadingState label="Memuat model lokal…" />
      ) : visibleModels.length === 0 ? (
        <EmptyState
          icon={HardDrive}
          title={models.length === 0 ? "Belum ada model yang di-download" : "Model tidak ditemukan"}
          description={
            models.length === 0
              ? "Buka Explore untuk mencari dan men-download model GGUF."
              : "Coba kata kunci lain atau kosongkan pencarian."
          }
          action={
            models.length > 0 && onClearSearch ? (
              <Button type="button" size="sm" variant="outline" onClick={onClearSearch}>
                Reset pencarian
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-2">
          {visibleModels.map((m) => (
            <DownloadedModelCard
              key={m.id}
              model={m}
              confirmId={confirmId}
              deleting={deleting}
              onConfirm={() => setConfirmId(m.id)}
              onCancel={() => setConfirmId(null)}
              onRemove={() => {
                void remove(m.id);
                setConfirmId(null);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DownloadedModelCard({
  model,
  confirmId,
  deleting,
  onConfirm,
  onCancel,
  onRemove,
}: {
  model: CatalogModel;
  confirmId: string | null;
  deleting: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const confirming = confirmId === model.id;

  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 p-3 sm:gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium text-primary">{model.name}</span>
            <span
              className={cn(
                "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase",
                model.isGguf ? "bg-primary-soft text-primary" : "bg-warning/15 text-warning"
              )}
            >
              {model.isGguf ? "GGUF" : model.architecture || "local"}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-soft">
            <span className="truncate">{model.id}</span>
            <span className="tabular-nums">{formatSize(model.sizeMb)}</span>
          </div>
        </div>

        <span
          className="grid size-8 shrink-0 place-items-center rounded-full bg-success-soft text-success"
          title="Sudah di Ollama"
          aria-label="Sudah di-download"
        >
          <CheckCircle2 className="size-4" aria-hidden />
        </span>

        {confirming ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={deleting === model.id}
              onClick={onRemove}
            >
              {deleting === model.id ? "Menghapus…" : "Hapus"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
              Batal
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            className="shrink-0 text-ink-soft hover:text-danger"
            onClick={onConfirm}
            aria-label={`Hapus ${model.name}`}
            title="Hapus"
          >
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
