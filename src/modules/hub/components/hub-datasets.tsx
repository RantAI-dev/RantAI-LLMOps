"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Database, Download, ExternalLink, Heart, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FilterDropdown } from "@/components/ui/filter-dropdown";
import { FilterToolbar } from "@/components/ui/filter-toolbar";
import { LoadingState } from "@/components/ui/loading-state";
import type { HubDataset } from "@/lib/hf-hub";
import { useHubDatasets } from "@/modules/hub/hooks/use-hub-datasets";
import { compact } from "@/modules/hub/lib/format";

const SORTS = [
  { value: "trending", label: "Trending", hint: "HOT" },
  { value: "downloads", label: "Downloads", hint: "DL" },
  { value: "likes", label: "Likes", hint: "♥" },
  { value: "modified", label: "Updated", hint: "NEW" },
];

const CATEGORIES = [
  { value: "all", label: "Semua kategori", hint: "ALL" },
  { value: "task_categories:text-generation", label: "Text generation", hint: "GEN" },
  { value: "task_categories:conversational", label: "Conversational", hint: "CHAT" },
  { value: "task_categories:question-answering", label: "Question answering", hint: "QA" },
];

export function HubDatasets() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("trending");
  const [category, setCategory] = useState("all");
  const { datasets, loading, error, reload } = useHubDatasets(
    search,
    sort,
    category === "all" ? "" : category
  );
  const router = useRouter();

  function resetFilters() {
    setSearch("");
    setSort("trending");
    setCategory("all");
  }

  function pickForFinetune(id: string) {
    toast.success(`Dataset "${id}" dipilih untuk fine-tune`);
    router.push(`/finetune?dataset=${encodeURIComponent(id)}`);
  }

  return (
    <div className="space-y-4">
      <FilterToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search"
        searchAriaLabel="Cari dataset Hugging Face"
        searchAside={
          <FilterDropdown
            label="Sort"
            value={sort}
            onChange={setSort}
            options={SORTS}
            searchPlaceholder="Type sort…"
          />
        }
      >
        <FilterDropdown
          label="Kategori"
          value={category}
          onChange={setCategory}
          options={CATEGORIES}
          searchPlaceholder="Type category…"
        />
      </FilterToolbar>

      <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-surface-2 px-3 py-2.5 text-[12px] leading-5 text-ink-soft sm:flex-row sm:items-center sm:justify-between">
        <p>
          Dataset HF tidak perlu di-download. Trainer mengambilnya by-id saat fine-tune dijalankan.
        </p>
        <Link
          href="/datasets"
          className={buttonVariants({ size: "sm", variant: "outline", className: "shrink-0" })}
        >
          <Database className="size-4" /> Lihat dataset lokal
        </Link>
      </div>

      {error ? (
        <ErrorState title="Dataset gagal dimuat" description={error} onRetry={reload} />
      ) : loading ? (
        <LoadingState label="Memuat dataset dari Hugging Face…" />
      ) : datasets.length === 0 ? (
        <EmptyState
          icon={Database}
          title="Dataset tidak ditemukan"
          description="Coba kata kunci atau kategori lain."
          action={
            <Button type="button" size="sm" variant="outline" onClick={resetFilters}>
              Reset filter
            </Button>
          }
        />
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
