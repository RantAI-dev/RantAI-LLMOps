"use client";

import { useParams, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { DatasetDetailView } from "@/modules/datasets/components/dataset-detail-view";
import { useDatasets } from "@/modules/datasets/hooks/use-datasets";

/**
 * Route-level dataset detail (`/datasets/[...id]`). Deep-linkable, so the browser
 * Back button and refresh work. Reads the dataset from the shared DatasetsProvider
 * (mounted in the app layout) by id; the catch-all `id` segments are rejoined
 * because dataset ids can contain "/".
 */
export function DatasetDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id.join("/") : (params.id ?? "");

  const { getDatasetById, datasetsLoading, archiveDataset } = useDatasets();

  const dataset = getDatasetById(id);
  const back = () => router.push("/datasets");

  if (!dataset) {
    // Still loading the list (e.g. deep-link / refresh) → wait; otherwise it
    // genuinely doesn't exist.
    if (datasetsLoading) return <LoadingState label="Loading dataset…" />;
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <h2 className="text-lg font-semibold text-primary">Dataset not found</h2>
        <p className="mt-2 max-w-md text-sm text-ink-soft">
          This dataset doesn’t exist (or was removed). It may have been an old link.
        </p>
        <Button type="button" className="mt-6" onClick={back}>
          Back to Dataset Library
        </Button>
      </div>
    );
  }

  return (
    <DatasetDetailView
      dataset={dataset}
      onBack={back}
      onArchive={() => {
        archiveDataset(dataset.id);
        back();
      }}
    />
  );
}
