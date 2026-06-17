"use client";

import { Database, Download, Plus } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading-state";
import { CreateDatasetWizard } from "@/modules/datasets/components/create-dataset-wizard";
import { ImportHuggingFaceDatasetSheet } from "@/modules/datasets/components/import-huggingface-dataset-sheet";
import { DatasetCard } from "@/modules/datasets/components/dataset-card";
import { DatasetDetailView } from "@/modules/datasets/components/dataset-detail-view";
import { DatasetFiltersBar } from "@/modules/datasets/components/dataset-filters";
import { DatasetSummaryCards } from "@/modules/datasets/components/dataset-summary-cards";
import { datasetUi } from "@/modules/datasets/constants/dataset-ui";
import { useDatasets } from "@/modules/datasets/hooks/use-datasets";
import { useLlmOps } from "@/modules/llm-ops/context/llm-ops-provider";
import { cn } from "@/lib/utils";

type DatasetsPageProps = {
  initialSelectedId?: string | null;
  onInitialSelectedHandled?: () => void;
};

export function DatasetsPage({
  initialSelectedId,
  onInitialSelectedHandled,
}: DatasetsPageProps = {}) {
  const {
    datasets,
    filters,
    setFilters,
    resetFilters,
    filteredDatasets,
    selectedDataset,
    selectedDatasetId,
    setSelectedDatasetId,
    isCreateWizardOpen,
    setIsCreateWizardOpen,
    isHfImportOpen,
    setIsHfImportOpen,
    hfImportStep,
    setHfImportStep,
    hfToken,
    setHfToken,
    hfTokenStatus,
    validateHfToken,
    hfSearchQuery,
    setHfSearchQuery,
    hfSearchResults,
    searchHuggingFaceDatasets,
    selectedHfCatalogEntry,
    setSelectedHfCatalogEntry,
    hfImportConfig,
    setHfImportConfig,
    hfImportProgress,
    hfImportCurrentStep,
    hfImportError,
    isHfImporting,
    startHfImport,
    resetHfImportFlow,
    createDataset,
    archiveDataset,
    validateAgain,
    createNewVersion,
    setActiveVersion,
    rollbackVersion,
    saveSplit,
    updateSchemaMapping,
    uploadRagDocument,
    removeRagDocument,
    updateRagIndexConfig,
    reindexRagKnowledgeBase,
    datasetsLoading,
    datasetsError,
    reloadDatasets,
  } = useDatasets();

  const { setIsCreateExperimentOpen } = useLlmOps();

  // Consume a one-time navigation intent from the parent (e.g. open a specific
  // KB coming from the Documents page): select it, then tell the parent to clear
  // the intent. This is a legitimate prop->state sync + parent notification.
  useEffect(() => {
    if (!initialSelectedId) return;
    setSelectedDatasetId(initialSelectedId);
    onInitialSelectedHandled?.();
  }, [initialSelectedId, onInitialSelectedHandled, setSelectedDatasetId]);

  const activeDatasets = datasets.filter((d) => d.validationStatus !== "Archived");
  const showEmpty = activeDatasets.length === 0;
  const showFilteredEmpty = !showEmpty && filteredDatasets.length === 0;

  if (selectedDataset && selectedDatasetId) {
    return (
      <DatasetDetailView
        dataset={selectedDataset}
        onBack={() => setSelectedDatasetId(null)}
        onValidateAgain={() => validateAgain(selectedDataset.id)}
        onCreateVersion={() =>
          createNewVersion(selectedDataset.id, "Cleaned invalid rows and re-validated")
        }
        onArchive={() => archiveDataset(selectedDataset.id)}
        onUseInExperiment={() => setIsCreateExperimentOpen(true)}
        onSaveSplit={(split) => saveSplit(selectedDataset.id, split)}
        onUpdateMapping={(mapping) => updateSchemaMapping(selectedDataset.id, mapping)}
        onSetActiveVersion={(versionId) =>
          setActiveVersion(selectedDataset.id, versionId)
        }
        onRollback={(versionId) => rollbackVersion(selectedDataset.id, versionId)}
        onUploadRagDocument={(fileName, sizeBytes) =>
          uploadRagDocument(selectedDataset.id, fileName, sizeBytes)
        }
        onRemoveRagDocument={(documentId) =>
          removeRagDocument(selectedDataset.id, documentId)
        }
        onUpdateRagIndexConfig={(config) =>
          updateRagIndexConfig(selectedDataset.id, config)
        }
        onReindexRag={() => reindexRagKnowledgeBase(selectedDataset.id)}
      />
    );
  }

  return (
    <>
      <div className="min-w-0 w-full space-y-4">
        <div className="flex flex-col gap-4 border-b border-hairline pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className={cn("text-primary", datasetUi.title)}>Dataset Library</h1>
            <p className={cn("mt-1 max-w-2xl", datasetUi.subheading)}>
              Manage datasets for training, evaluation, knowledge bases, prompt testing, and agent
              benchmarks.
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => setIsHfImportOpen(true)}>
              <Download className="size-4" />
              Import from Hugging Face
            </Button>
            <Button type="button" onClick={() => setIsCreateWizardOpen(true)}>
              <Plus className="size-4" />
              Create Dataset
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
          <EmptyState
            onCreate={() => setIsCreateWizardOpen(true)}
            onImportHf={() => setIsHfImportOpen(true)}
          />
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
                onView={() => setSelectedDatasetId(dataset.id)}
                onValidateAgain={() => validateAgain(dataset.id)}
                onArchive={() => archiveDataset(dataset.id)}
              />
            ))}
          </div>
        )}
      </div>

      <CreateDatasetWizard
        key={isCreateWizardOpen ? "create-ds-open" : "create-ds-closed"}
        open={isCreateWizardOpen}
        onClose={() => setIsCreateWizardOpen(false)}
        onSave={createDataset}
        onOpenHuggingFaceImport={() => {
          setIsCreateWizardOpen(false);
          setIsHfImportOpen(true);
        }}
        onSaveAndUseExperiment={() => {
          setIsCreateExperimentOpen(true);
        }}
      />

      <ImportHuggingFaceDatasetSheet
        open={isHfImportOpen}
        onClose={() => setIsHfImportOpen(false)}
        importStep={hfImportStep}
        setImportStep={setHfImportStep}
        hfToken={hfToken}
        setHfToken={setHfToken}
        tokenStatus={hfTokenStatus}
        validateToken={validateHfToken}
        searchQuery={hfSearchQuery}
        setSearchQuery={setHfSearchQuery}
        searchResults={hfSearchResults}
        searchHuggingFaceDatasets={searchHuggingFaceDatasets}
        selectedCatalogEntry={selectedHfCatalogEntry}
        setSelectedCatalogEntry={setSelectedHfCatalogEntry}
        importConfig={hfImportConfig}
        setImportConfig={setHfImportConfig}
        importProgress={hfImportProgress}
        importCurrentStep={hfImportCurrentStep}
        importError={hfImportError}
        isImporting={isHfImporting}
        startImport={startHfImport}
        resetImportFlow={resetHfImportFlow}
        onImportComplete={(datasetId) => setSelectedDatasetId(datasetId)}
      />
    </>
  );
}

function EmptyState({
  onCreate,
  onImportHf,
}: {
  onCreate: () => void;
  onImportHf: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 px-6 py-16 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-full bg-primary-soft">
        <Database className="size-7 text-primary" />
      </div>
      <h2 className="text-lg font-semibold text-primary">No datasets yet</h2>
      <p className="mt-2 max-w-md text-sm text-ink-soft">
        Upload or connect your first dataset to start the AI data lifecycle — preview, map schema,
        validate, version, and use in experiments.
      </p>
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Button type="button" variant="outline" onClick={onImportHf}>
          <Download className="size-4" />
          Import from Hugging Face
        </Button>
        <Button type="button" onClick={onCreate}>
          <Plus className="size-4" />
          Create Dataset
        </Button>
      </div>
    </div>
  );
}
