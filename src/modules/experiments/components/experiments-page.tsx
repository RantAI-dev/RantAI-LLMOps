"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingState } from "@/components/ui/loading-state";
import { useExperiments } from "@/modules/experiments/hooks/use-experiments";
import { cn } from "@/lib/utils";
import type { Experiment } from "@/modules/experiments/types";
import type { CreateExperimentInput } from "@/modules/experiments/types";

import { DeleteExperimentDialog } from "./delete-experiment-dialog";
import { ExperimentCard } from "./experiment-card";
import { ExperimentDetailView } from "./experiment-detail-view";
import { ExperimentFiltersBar } from "./experiment-filters";
import { ExperimentFormSheet } from "./experiment-form-sheet";
import { ExperimentSummaryCards } from "./experiment-summary-cards";
import { experimentUi } from "../constants/experiment-ui";

export function ExperimentsPage() {
  const {
    experiments,
    tasks,
    filters,
    setFilters,
    resetFilters,
    filteredExperiments,
    selectedExperiment,
    selectedExperimentId,
    setSelectedExperimentId,
    isCreateOpen,
    setIsCreateOpen,
    deleteTargetId,
    setDeleteTargetId,
    createExperiment,
    updateExperiment,
    cloneExperiment,
    archiveExperiment,
    deleteExperiment,
    changeExperimentStatus,
    isLoading,
    isError,
    reload,
  } = useExperiments();

  const [editingExperiment, setEditingExperiment] = useState<Experiment | null>(null);

  const deleteExperimentEntity =
    deleteTargetId != null ? experiments.find((e) => e.id === deleteTargetId) ?? null : null;

  const showEmpty = experiments.length === 0;
  const showFilteredEmpty = !showEmpty && filteredExperiments.length === 0;

  if (selectedExperiment && selectedExperimentId) {
    return (
      <>
        <ExperimentDetailView
          experiment={selectedExperiment}
          tasks={tasks}
          onBack={() => setSelectedExperimentId(null)}
          onEdit={() => setEditingExperiment(selectedExperiment)}
          onClone={() => cloneExperiment(selectedExperiment.id)}
          onArchive={() => archiveExperiment(selectedExperiment.id)}
          onDelete={() => setDeleteTargetId(selectedExperiment.id)}
          onChangeStatus={(status) => changeExperimentStatus(selectedExperiment.id, status)}
        />
        <ExperimentFormSheet
          key={editingExperiment?.id ?? "exp-edit-closed"}
          open={!!editingExperiment}
          mode="edit"
          experiment={editingExperiment}
          onClose={() => setEditingExperiment(null)}
          onSubmit={(input: CreateExperimentInput) => {
            if (editingExperiment) {
              updateExperiment(editingExperiment.id, input);
              setEditingExperiment(null);
            }
          }}
        />
        <DeleteExperimentDialog
          experiment={deleteExperimentEntity}
          tasks={tasks}
          onClose={() => setDeleteTargetId(null)}
          onConfirm={() => {
            if (deleteTargetId) deleteExperiment(deleteTargetId);
          }}
        />
      </>
    );
  }

  return (
    <div className="min-w-0 w-full space-y-4">
      <div className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className={cn("text-primary", experimentUi.title)}>Experiments</h1>
          <p className={cn("mt-1 max-w-2xl", experimentUi.subheading)}>
            Organize LLM experiments, model trials, datasets, and related AI tasks.
          </p>
        </div>
        <Button type="button" className="shrink-0" onClick={() => setIsCreateOpen(true)}>
          <Plus className="size-4" />
          Create Experiment
        </Button>
      </div>

      <ExperimentSummaryCards experiments={experiments} tasks={tasks} />

      {!isLoading && !isError ? (
        <ExperimentFiltersBar
          filters={filters}
          onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
          onReset={resetFilters}
        />
      ) : null}

      {isLoading ? (
        <LoadingState label="Loading experiments…" />
      ) : isError ? (
        <ErrorState onRetry={reload} />
      ) : showEmpty ? (
        <EmptyState
          title="No experiments found"
          description="Create your first LLM experiment to start organizing model trials, datasets, and AI tasks."
          actionLabel="Create Experiment"
          onAction={() => setIsCreateOpen(true)}
        />
      ) : showFilteredEmpty ? (
        <EmptyState
          title="No matching experiments"
          description="Try adjusting your search or filter criteria."
          actionLabel="Reset Filter"
          onAction={resetFilters}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredExperiments.map((experiment) => (
            <ExperimentCard
              key={experiment.id}
              experiment={experiment}
              tasks={tasks}
              onView={() => setSelectedExperimentId(experiment.id)}
              onEdit={() => setEditingExperiment(experiment)}
              onClone={() => cloneExperiment(experiment.id)}
              onArchive={() => archiveExperiment(experiment.id)}
              onDelete={() => setDeleteTargetId(experiment.id)}
            />
          ))}
        </div>
      )}

      <ExperimentFormSheet
        key={isCreateOpen ? "exp-create-open" : "exp-create-closed"}
        open={isCreateOpen}
        mode="create"
        onClose={() => setIsCreateOpen(false)}
        onSubmit={(input) => {
          const id = createExperiment(input);
          setSelectedExperimentId(id);
        }}
      />

      <ExperimentFormSheet
        key={editingExperiment?.id ?? "exp-edit-closed"}
        open={!!editingExperiment}
        mode="edit"
        experiment={editingExperiment}
        onClose={() => setEditingExperiment(null)}
        onSubmit={(input) => {
          if (editingExperiment) {
            updateExperiment(editingExperiment.id, input);
            setEditingExperiment(null);
          }
        }}
      />

      <DeleteExperimentDialog
        experiment={deleteExperimentEntity}
        tasks={tasks}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={() => {
          if (deleteTargetId) deleteExperiment(deleteTargetId);
        }}
      />
    </div>
  );
}

function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center">
      <h3 className="text-base font-semibold text-primary">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">{description}</p>
      <Button type="button" className="mt-4" onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  );
}
