"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";
import { useExperiments } from "@/modules/experiments/hooks/use-experiments";
import type { CreateExperimentInput, Experiment } from "@/modules/experiments/types";

import { DeleteExperimentDialog } from "./delete-experiment-dialog";
import { ExperimentDetailView } from "./experiment-detail-view";
import { ExperimentFormSheet } from "./experiment-form-sheet";

/**
 * Route-level experiment detail (`/experiments/[...id]`). Deep-linkable, so the
 * browser Back button and refresh work. Reads from the shared LlmOps provider
 * (mounted in the app layout) by id.
 */
export function ExperimentDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id.join("/") : (params.id ?? "");

  const {
    experiments,
    tasks,
    isLoading,
    updateExperiment,
    cloneExperiment,
    archiveExperiment,
    deleteExperiment,
    changeExperimentStatus,
    deleteTargetId,
    setDeleteTargetId,
  } = useExperiments();

  const [editingExperiment, setEditingExperiment] = useState<Experiment | null>(null);

  const experiment = experiments.find((e) => e.id === id) ?? null;
  const deleteEntity =
    deleteTargetId != null ? experiments.find((e) => e.id === deleteTargetId) ?? null : null;
  const back = () => router.push("/experiments");

  if (!experiment) {
    if (isLoading) return <LoadingState label="Loading experiment…" />;
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-16 text-center">
        <h2 className="text-lg font-semibold text-primary">Experiment not found</h2>
        <p className="mt-2 max-w-md text-sm text-ink-soft">
          This experiment doesn’t exist (or was removed).
        </p>
        <Button type="button" className="mt-6" onClick={back}>
          Back to Experiments
        </Button>
      </div>
    );
  }

  return (
    <>
      <ExperimentDetailView
        experiment={experiment}
        tasks={tasks}
        onBack={back}
        onEdit={() => setEditingExperiment(experiment)}
        onClone={() => cloneExperiment(experiment.id)}
        onArchive={() => archiveExperiment(experiment.id)}
        onDelete={() => setDeleteTargetId(experiment.id)}
        onChangeStatus={(status) => changeExperimentStatus(experiment.id, status)}
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
        experiment={deleteEntity}
        tasks={tasks}
        onClose={() => setDeleteTargetId(null)}
        onConfirm={() => {
          if (deleteTargetId) {
            deleteExperiment(deleteTargetId);
            back();
          }
        }}
      />
    </>
  );
}
