"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, ExternalLink, Heart, Loader2, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { HubDataset } from "@/lib/hf-hub";
import { useHubDatasets } from "@/modules/hub/hooks/use-hub-datasets";
import { compact } from "@/modules/hub/lib/format";
import { cn } from "@/lib/utils";

const SORTS = [
  { value: "trending", label: "Trending" },
  { value: "downloads", label: "Downloads" },
  { value: "likes", label: "Likes" },
  { value: "modified", label: "Updated" },
];

export function HubDatasets() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("trending");
  const { datasets, loading, error } = useHubDatasets(search, sort);
  const router = useRouter();

  function pickForFinetune(id: string) {
    toast.success(`Dataset "${id}" dipilih untuk fine-tune`);
    router.push(`/finetune?dataset=${encodeURIComponent(id)}`);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari dataset di Hugging Face… (mis. rugby, alpaca)"
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          {SORTS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setSort(s.value)}
              className={cn(
                "rounded-md px-2 py-1.5 text-[12px] transition-colors",
                sort === s.value ? "bg-primary-soft font-medium text-primary" : "text-ink hover:bg-surface-2"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[11px] leading-4 text-ink-faint">
        Dataset tidak perlu di-download — trainer menariknya dari HF by-id saat runtime. &quot;Use in
        fine-tune&quot; menyalin id-nya untuk dipakai di form.
      </p>

      {error ? (
        <div className="rounded-lg border border-dashed border-danger/40 bg-danger/5 p-4 text-sm text-danger">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-ink-soft">
          <Loader2 className="size-4 animate-spin" /> Memuat dari Hugging Face…
        </div>
      ) : datasets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-ink-soft">
          Tidak ada dataset yang cocok.
        </div>
      ) : (
        <div className="space-y-2">
          {datasets.map((d) => (
            <HubDatasetCard key={d.id} dataset={d} onUse={() => pickForFinetune(d.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function HubDatasetCard({ dataset, onUse }: { dataset: HubDataset; onUse: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-primary">{dataset.id}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-ink-soft">
          <span className="inline-flex items-center gap-0.5">
            <Download className="size-3" /> {compact(dataset.downloads)}
          </span>
          <span className="inline-flex items-center gap-0.5">
            <Heart className="size-3" /> {compact(dataset.likes)}
          </span>
        </div>
      </div>
      <a
        href={`https://huggingface.co/datasets/${dataset.id}`}
        target="_blank"
        rel="noreferrer"
        className="grid size-8 place-items-center rounded-md text-ink-soft hover:bg-surface-2"
        title="Buka di Hugging Face"
      >
        <ExternalLink className="size-4" />
      </a>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          void navigator.clipboard?.writeText(dataset.id);
          toast.success("Dataset id disalin");
        }}
        title="Salin id"
      >
        <Copy className="size-4" />
      </Button>
      <Button type="button" size="sm" onClick={onUse}>
        <Sparkles className="size-4" /> Use in fine-tune
      </Button>
    </div>
  );
}
