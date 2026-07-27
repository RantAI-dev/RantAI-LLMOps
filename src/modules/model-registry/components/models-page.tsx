"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading-state";
import { DeleteModelDialog } from "@/modules/model-registry/components/delete-model-dialog";
import { ModelFiltersBar } from "@/modules/model-registry/components/model-filters";
import { ModelSummaryCards } from "@/modules/model-registry/components/model-summary-cards";
import { ModelTable } from "@/modules/model-registry/components/model-table";
import { modelRegistryUi } from "@/modules/model-registry/constants/model-registry-ui";
import { baseSearchQuery, filterModels } from "@/modules/model-registry/lib/utils";
import { useModelRegistry } from "@/modules/model-registry/hooks/use-model-registry";
import type { ModelFilters, RegistryModel } from "@/modules/model-registry/types";
import { detailHref } from "@/lib/detail-href";
import { cn } from "@/lib/utils";

const defaultFilters: ModelFilters = {
  search: "",
  provider: "all",
  task: "all",
  status: "all",
  access: "all",
  compatibility: "all",
};

/** Returns `value` delayed by `delayMs`, resetting the timer on each change. */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function ModelsPage() {
  const {
    models,
    summaryStats,
    deleteTargetId,
    setDeleteTargetId,
    deleteModel,
    modelsLoading,
    modelsError,
    reloadModels,
  } = useModelRegistry();
  const router = useRouter();
  const openModel = (id: string) => router.push(detailHref("/models", id));
  // Real destinations, each carrying the model so the target page preselects it
  // (no placeholder toasts). Test -> chat playground; Compare -> Generations
  // (base or fine-tuned slot); Fine-tune -> opens the HF base search prefilled
  // (a GGUF can't be a training base itself, so we jump-start the search).
  const testModel = (id: string) => router.push(`/interact?model=${encodeURIComponent(id)}`);
  const compareModel = (id: string) =>
    router.push(
      /^(rantai|nqr)-/.test(id)
        ? `/generations?ft=${encodeURIComponent(id)}`
        : `/generations?base=${encodeURIComponent(id)}`
    );
  const fineTuneModel = (id: string) =>
    router.push(`/finetune?base=${encodeURIComponent(baseSearchQuery(id))}`);
  // Downloading from Hugging Face lives in the dedicated Hub (real `ollama pull
  // hf.co/…` with quant + progress), so the registry's Import button points there
  // instead of the old preview flow.
  const goToHub = () => router.push("/hub");

  const deleteTarget = deleteTargetId
    ? models.find((m) => m.id === deleteTargetId) ?? null
    : null;

  const showEmpty = models.length === 0;

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

      {modelsLoading ? (
        <LoadingState label="Loading models…" />
      ) : modelsError ? (
        <ErrorState onRetry={reloadModels} />
      ) : showEmpty ? (
        <EmptyState onImport={goToHub} />
      ) : (
        <ModelBrowser
          models={models}
          onView={openModel}
          onTest={testModel}
          onFineTune={fineTuneModel}
          onCompare={compareModel}
          onDelete={setDeleteTargetId}
        />
      )}

      <DeleteModelDialog
        model={deleteTarget}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={() => deleteTargetId && deleteModel(deleteTargetId)}
      />
    </div>
  );
}

/**
 * Owns the filter/search state locally so typing in the filter bar re-renders
 * only this subtree (the bar + table) — not the summary cards or any other
 * consumer of the model-registry data context. The search term drives filtering
 * through a ~250ms debounce, so the (potentially large) table re-computes and
 * re-renders after the user pauses rather than on every keystroke.
 */
function ModelBrowser({
  models,
  onView,
  onTest,
  onFineTune,
  onCompare,
  onDelete,
}: {
  models: RegistryModel[];
  onView: (id: string) => void;
  onTest: (id: string) => void;
  onFineTune: (id: string) => void;
  onCompare: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [filters, setFilters] = useState<ModelFilters>(defaultFilters);
  const resetFilters = useCallback(() => setFilters(defaultFilters), []);
  const debouncedSearch = useDebouncedValue(filters.search, 250);

  // Non-search filters (selects) apply immediately; only `search` is debounced.
  const filteredModels = useMemo(
    () => filterModels(models, { ...filters, search: debouncedSearch }),
    [models, filters, debouncedSearch]
  );

  return (
    <>
      <ModelFiltersBar
        filters={filters}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        onReset={resetFilters}
      />
      {filteredModels.length === 0 ? (
        <FilteredEmptyState onReset={resetFilters} />
      ) : (
        <ModelTable
          models={filteredModels}
          onView={onView}
          onTest={onTest}
          onFineTune={onFineTune}
          onCompare={onCompare}
          onDelete={onDelete}
        />
      )}
    </>
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
