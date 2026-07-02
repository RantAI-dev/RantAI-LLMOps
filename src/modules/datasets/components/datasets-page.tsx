"use client";

import { Database, Download } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading-state";
import { DatasetCard } from "@/modules/datasets/components/dataset-card";
import { DatasetFiltersBar } from "@/modules/datasets/components/dataset-filters";
import { DatasetSummaryCards } from "@/modules/datasets/components/dataset-summary-cards";
import { datasetUi } from "@/modules/datasets/constants/dataset-ui";
import { datasetHref } from "@/modules/datasets/lib/routes";
import { useDatasets } from "@/modules/datasets/hooks/use-datasets";
import { cn } from "@/lib/utils";

export function DatasetsPage() {
  const {
    datasets,
    filters,
    setFilters,
    resetFilters,
    filteredDatasets,
    archiveDataset,
    datasetsLoading,
    datasetsError,
    reloadDatasets,
  } = useDatasets();

  const router = useRouter();

  // Datasets reach Transformer Lab either by being pulled from Hugging Face at
  // training time (the trainer does `load_dataset(id)`) or via the real Hub. The
  // app has no honest "create a dataset from scratch" path, so this page is a
  // viewer + a jump to the Hub — not a mock create wizard.
  const goToHub = () => router.push("/hub");

  const activeDatasets = datasets.filter((d) => d.validationStatus !== "Archived");
  const showEmpty = activeDatasets.length === 0;
  const showFilteredEmpty = !showEmpty && filteredDatasets.length === 0;

  return (
    <div className="min-w-0 w-full space-y-4">
      <div className="flex flex-col gap-4 border-b border-hairline pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className={cn("text-primary", datasetUi.title)}>Dataset Library</h1>
          <p className={cn("mt-1 max-w-2xl", datasetUi.subheading)}>
            Datasets on disk in Transformer Lab. Browse Hugging Face in the Hub, or just use a
            dataset id directly in Fine-tune — the trainer downloads it at runtime.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Button type="button" onClick={goToHub}>
            <Download className="size-4" />
            Browse Hugging Face
          </Button>
        </div>
      </div>

      <DatasetSummaryCards datasets={datasets} />

      {!datasetsLoading && !datasetsError ? (
        <DatasetFiltersBar
          filters={filters}
          onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
          onReset={resetFilters}
        />
      ) : null}

      {datasetsLoading ? (
        <LoadingState label="Loading datasets…" />
      ) : datasetsError ? (
        <ErrorState onRetry={reloadDatasets} />
      ) : showEmpty ? (
        <EmptyState onBrowseHub={goToHub} />
      ) : showFilteredEmpty ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center">
          <p className="text-sm text-ink-soft">No datasets match your filters.</p>
          <Button type="button" variant="outline" className="mt-3" onClick={resetFilters}>
            Reset filters
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {filteredDatasets.map((dataset) => (
            <DatasetCard
              key={dataset.id}
              dataset={dataset}
              onView={() => router.push(datasetHref(dataset.id))}
              onArchive={() => archiveDataset(dataset.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ onBrowseHub }: { onBrowseHub: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 py-16 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-full bg-primary-soft">
        <Database className="size-7 text-primary" />
      </div>
      <h2 className="text-lg font-semibold text-primary">No datasets yet</h2>
      <p className="mt-2 max-w-md text-sm text-ink-soft">
        Datasets appear here once they’re on the Transformer Lab disk — e.g. after a fine-tune pulls
        one from Hugging Face. Browse the Hub to find one, or use a dataset id directly in Fine-tune.
      </p>
      <div className="mt-6">
        <Button type="button" onClick={onBrowseHub}>
          <Download className="size-4" />
          Browse Hugging Face
        </Button>
      </div>
    </div>
  );
}
