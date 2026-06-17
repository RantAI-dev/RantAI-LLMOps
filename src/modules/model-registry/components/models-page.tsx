"use client";

import { Download, HardDrive } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ArchiveModelDialog } from "@/modules/model-registry/components/archive-model-dialog";
import { ImportHuggingFaceSheet } from "@/modules/model-registry/components/import-huggingface-sheet";
import { ModelDetailView } from "@/modules/model-registry/components/model-detail-view";
import { ModelFiltersBar } from "@/modules/model-registry/components/model-filters";
import { ModelSummaryCards } from "@/modules/model-registry/components/model-summary-cards";
import { ModelTable } from "@/modules/model-registry/components/model-table";
import { RegisterLocalSheet } from "@/modules/model-registry/components/register-local-sheet";
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
    isImportOpen,
    setIsImportOpen,
    isRegisterLocalOpen,
    setIsRegisterLocalOpen,
    archiveTargetId,
    setArchiveTargetId,
    hfToken,
    setHfToken,
    tokenStatus,
    validateToken,
    searchQuery,
    setSearchQuery,
    searchResults,
    searchHuggingFace,
    selectedCatalogEntry,
    setSelectedCatalogEntry,
    importConfig,
    setImportConfig,
    importStep,
    setImportStep,
    importProgress,
    importCurrentStep,
    importError,
    isImporting,
    startImport,
    resetImportFlow,
    archiveModel,
    deployModel,
    stopDeployment,
    runEvaluation,
    registerLocalModel,
    showToast,
  } = useModelRegistry();

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
          onDeploy={(env) => deployModel(selectedModel.id, env)}
          onFineTune={() =>
            showToast({ title: "Fine-tune workflow", description: "Fine-tune setup will open here.", variant: "info" })
          }
          onCompare={() =>
            showToast({ title: "Compare models", description: "Model comparison view will open here.", variant: "info" })
          }
          onArchive={() => setArchiveTargetId(selectedModel.id)}
          onStopDeployment={() => stopDeployment(selectedModel.id)}
          onRunEvaluation={() => runEvaluation(selectedModel.id)}
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
          <Button type="button" variant="outline" onClick={() => setIsRegisterLocalOpen(true)}>
            <HardDrive className="size-4" />
            Register Local Model
          </Button>
          <Button type="button" onClick={() => setIsImportOpen(true)}>
            <Download className="size-4" />
            Import from Hugging Face
          </Button>
        </div>
      </div>

      <ModelSummaryCards stats={summaryStats} />

      {!showEmpty ? (
        <ModelFiltersBar
          filters={filters}
          onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
          onReset={resetFilters}
        />
      ) : null}

      {showEmpty ? (
        <EmptyState
          onImport={() => setIsImportOpen(true)}
          onRegisterLocal={() => setIsRegisterLocalOpen(true)}
        />
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
          onDeploy={(id) => deployModel(id, "Staging")}
          onFineTune={() =>
            showToast({ title: "Fine-tune workflow", description: "Fine-tune setup will open here.", variant: "info" })
          }
          onCompare={() =>
            showToast({ title: "Compare models", description: "Model comparison view will open here.", variant: "info" })
          }
          onArchive={setArchiveTargetId}
        />
      )}

      <ImportHuggingFaceSheet
        open={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        importStep={importStep}
        setImportStep={setImportStep}
        hfToken={hfToken}
        setHfToken={setHfToken}
        tokenStatus={tokenStatus}
        validateToken={validateToken}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchResults={searchResults}
        searchHuggingFace={searchHuggingFace}
        selectedCatalogEntry={selectedCatalogEntry}
        setSelectedCatalogEntry={setSelectedCatalogEntry}
        importConfig={importConfig}
        setImportConfig={setImportConfig}
        importProgress={importProgress}
        importCurrentStep={importCurrentStep}
        importError={importError}
        isImporting={isImporting}
        startImport={startImport}
        resetImportFlow={resetImportFlow}
        onImportComplete={(modelId) => setSelectedModelId(modelId)}
      />

      <RegisterLocalSheet
        key={isRegisterLocalOpen ? "register-open" : "register-closed"}
        open={isRegisterLocalOpen}
        onClose={() => setIsRegisterLocalOpen(false)}
        onSubmit={registerLocalModel}
        onViewModel={setSelectedModelId}
      />

      <ArchiveModelDialog
        model={archiveTarget}
        onClose={() => setArchiveTargetId(null)}
        onConfirm={() => archiveTargetId && archiveModel(archiveTargetId)}
      />
    </div>
  );
}

function EmptyState({
  onImport,
  onRegisterLocal,
}: {
  onImport: () => void;
  onRegisterLocal: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center">
      <h3 className="text-base font-semibold text-primary">No models registered yet</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
        Import models from Hugging Face or register your local model to start building your LLM workflow.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button type="button" onClick={onImport}>
          <Download className="size-4" />
          Import from Hugging Face
        </Button>
        <Button type="button" variant="outline" onClick={onRegisterLocal}>
          <HardDrive className="size-4" />
          Register Local Model
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
