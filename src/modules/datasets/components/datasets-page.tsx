"use client";

import { CloudDownload, Database, Download, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PdfCorpusPanel } from "@/modules/corpus";
import { DatasetCard } from "@/modules/datasets/components/dataset-card";
import { DatasetFiltersBar } from "@/modules/datasets/components/dataset-filters";
import { DatasetSummaryCards } from "@/modules/datasets/components/dataset-summary-cards";
import { UploadDatasetDialog } from "@/modules/datasets/components/upload-dataset-dialog";
import { datasetUi } from "@/modules/datasets/constants/dataset-ui";
import { datasetHref } from "@/modules/datasets/lib/routes";
import { useDatasets } from "@/modules/datasets/hooks/use-datasets";
import type { DatasetFilters } from "@/modules/datasets/types";
import { cn } from "@/lib/utils";

const defaultFilters: DatasetFilters = {
  search: "",
  datasetType: "all",
  source: "all",
  validationStatus: "all",
  sort: "updated",
};

export function DatasetsPage() {
  const { datasets, datasetsLoading, datasetsError, reloadDatasets } = useDatasets();

  const router = useRouter();
  const [uploadOpen, setUploadOpen] = useState(false);

  // Filter/search state lives here (not in the shared DatasetsProvider) so typing
  // only re-renders this page — not every consumer of the datasets data context.
  const [filters, setFilters] = useState<DatasetFilters>(defaultFilters);
  const resetFilters = () => setFilters(defaultFilters);

  // Debounce the search term (~250ms) so the input stays responsive but filtering
  // (and the card re-render it drives) doesn't run on every keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search), 250);
    return () => clearTimeout(t);
  }, [filters.search]);

  const { datasetType, source, validationStatus, sort } = filters;
  const filteredDatasets = useMemo(() => {
    let result = datasets;
    const q = debouncedSearch.trim().toLowerCase();

    if (q) {
      result = result.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.description.toLowerCase().includes(q) ||
          d.owner.toLowerCase().includes(q) ||
          d.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    if (datasetType !== "all") {
      result = result.filter((d) => d.datasetType === datasetType);
    }
    if (source !== "all") {
      result = result.filter((d) => d.source === source);
    }
    if (validationStatus !== "all") {
      result = result.filter((d) => d.validationStatus === validationStatus);
    }

    // Copy before sorting so we never mutate the provider's datasets array in place.
    return [...result].sort((a, b) => {
      switch (sort) {
        case "newest":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "oldest":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "name":
          return a.name.localeCompare(b.name);
        case "usage":
          return b.usageCount - a.usageCount;
        case "updated":
        default:
          return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime();
      }
    });
  }, [datasets, debouncedSearch, datasetType, source, validationStatus, sort]);

  // Datasets reach Transformer Lab three ways: pulled from Hugging Face at training
  // time (the trainer does `load_dataset(id)`), browsed via the real Hub, or
  // uploaded here as a real .jsonl/.csv file (registered in TL, then usable in
  // Fine-tune). No mock create wizard.
  const goToHub = () => router.push("/hub");

  const showEmpty = datasets.length === 0;
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
          <Button type="button" variant="outline" onClick={() => router.push("/datasets/import")}>
            <CloudDownload className="size-4" />
            Import from S3
          </Button>
          <Button type="button" variant="outline" onClick={() => setUploadOpen(true)}>
            <Upload className="size-4" />
            Upload dataset
          </Button>
          <Button type="button" onClick={goToHub}>
            <Download className="size-4" />
            Browse Hugging Face
          </Button>
        </div>
      </div>

      <UploadDatasetDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => reloadDatasets()}
      />

      <Tabs defaultValue="library">
        <TabsList className="h-auto w-full justify-start gap-1 rounded-lg border border-hairline bg-surface p-1">
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="pdf">From PDF</TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="mt-2 space-y-4">
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
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Corpus pre-processing: a book PDF in, citation-headed chunks out. */}
        <TabsContent value="pdf" className="mt-2">
          <PdfCorpusPanel />
        </TabsContent>
      </Tabs>
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
