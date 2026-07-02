"use client";

import { useRouter } from "next/navigation";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading-state";
import { ArchiveModelDialog } from "@/modules/model-registry/components/archive-model-dialog";
import { ModelDetailView } from "@/modules/model-registry/components/model-detail-view";
import { ModelFiltersBar } from "@/modules/model-registry/components/model-filters";
import { ModelSummaryCards } from "@/modules/model-registry/components/model-summary-cards";
import { ModelTable } from "@/modules/model-registry/components/model-table";
import { modelRegistryUi } from "@/modules/model-registry/constants/model-registry-ui";
import { useModelRegistry } from "@/modules/model-registry/hooks/use-model-registry";
import { cn } from "@/lib/utils";

export function ModelsPage() {
  const {
    models,
    filters,
    setFilters,
    resetFilters,
    filteredModels,
    summaryStats,
    selectedModel,
    selectedModelId,
    setSelectedModelId,
    archiveTargetId,
    setArchiveTargetId,
    archiveModel,
    showToast,
    modelsLoading,
    modelsError,
    reloadModels,
  } = useModelRegistry();
  const router = useRouter();
  // Downloading from Hugging Face lives in the dedicated Hub (real `ollama pull
  // hf.co/…` with quant + progress), so the registry's Import button points there
  // instead of the old preview flow.
  const goToHub = () => router.push("/hub");

  const archiveTarget = archiveTargetId
    ? models.find((m) => m.id === archiveTargetId) ?? null
    : null;

  const activeModels = models.filter((m) => m.status !== "Archived");
  const showEmpty = activeModels.length === 0;
  const showFilteredEmpty = !showEmpty && filteredModels.length === 0;

  if (selectedModel && selectedModelId) {
    return (
      <>
        <ModelDetailView
          model={selectedModel}
          onBack={() => setSelectedModelId(null)}
          onTest={() =>
            showToast({
              title: "Opening Playground",
              description: "Test this model in Playground before deploying to production.",
              variant: "info",
            })
          }
          onFineTune={() =>
            showToast({ title: "Fine-tune workflow", description: "Fine-tune setup will open here.", variant: "info" })
          }
          onCompare={() =>
            showToast({ title: "Compare models", description: "Model comparison view will open here.", variant: "info" })
          }
          onArchive={() => setArchiveTargetId(selectedModel.id)}
        />
        <ArchiveModelDialog
          model={archiveTarget}
          onClose={() => setArchiveTargetId(null)}
          onConfirm={() => archiveTargetId && archiveModel(archiveTargetId)}
        />
      </>
    );
  }

  return (
    <div className="min-w-0 w-full space-y-4">
      <div className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className={cn("text-primary", modelRegistryUi.title)}>Model Registry</h1>
          <p className={cn("mt-1 max-w-2xl", modelRegistryUi.subheading)}>
            Manage, import, test, and deploy AI models across your LLM Ops platform.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" onClick={goToHub}>
            <Download className="size-4" />
            Import from Hugging Face
          </Button>
        </div>
      </div>

      <ModelSummaryCards stats={summaryStats} />

      {!showEmpty && !modelsLoading && !modelsError ? (
        <ModelFiltersBar
          filters={filters}
          onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
          onReset={resetFilters}
        />
      ) : null}

      {modelsLoading ? (
        <LoadingState label="Loading models…" />
      ) : modelsError ? (
        <ErrorState onRetry={reloadModels} />
      ) : showEmpty ? (
        <EmptyState onImport={goToHub} />
      ) : showFilteredEmpty ? (
        <FilteredEmptyState onReset={resetFilters} />
      ) : (
        <ModelTable
          models={filteredModels}
          onView={setSelectedModelId}
          onTest={() =>
            showToast({
              title: "Opening Playground",
              description: "Test this model in Playground before deploying to production.",
              variant: "info",
            })
          }
          onFineTune={() =>
            showToast({ title: "Fine-tune workflow", description: "Fine-tune setup will open here.", variant: "info" })
          }
          onCompare={() =>
            showToast({ title: "Compare models", description: "Model comparison view will open here.", variant: "info" })
          }
          onArchive={setArchiveTargetId}
        />
      )}

      <ArchiveModelDialog
        model={archiveTarget}
        onClose={() => setArchiveTargetId(null)}
        onConfirm={() => archiveTargetId && archiveModel(archiveTargetId)}
      />
    </div>
  );
}

function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center">
      <h3 className="text-base font-semibold text-primary">No models yet</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
        Download a model from Hugging Face (via the Hub) to start building your LLM workflow.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button type="button" onClick={onImport}>
          <Download className="size-4" />
          Import from Hugging Face
        </Button>
      </div>
    </div>
  );
}

function FilteredEmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center">
      <h3 className="text-base font-semibold text-primary">No matching models</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
        Try adjusting your search or filter criteria.
      </p>
      <Button type="button" className="mt-4" variant="outline" onClick={onReset}>
        Reset Filters
      </Button>
    </div>
  );
}
