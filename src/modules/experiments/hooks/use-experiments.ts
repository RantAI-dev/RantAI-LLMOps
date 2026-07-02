"use client";

import { useLlmOps } from "@/modules/llm-ops/context/llm-ops-provider";

export function useExperiments() {
  const ctx = useLlmOps();

  return {
    experiments: ctx.experiments,
    tasks: ctx.tasks,
    filters: ctx.experimentFilters,
    setFilters: ctx.setExperimentFilters,
    resetFilters: ctx.resetExperimentFilters,
    filteredExperiments: ctx.filteredExperiments,
    isCreateOpen: ctx.isCreateExperimentOpen,
    setIsCreateOpen: ctx.setIsCreateExperimentOpen,
    deleteTargetId: ctx.deleteExperimentTargetId,
    setDeleteTargetId: ctx.setDeleteExperimentTargetId,
    createExperiment: ctx.createExperiment,
    updateExperiment: ctx.updateExperiment,
    cloneExperiment: ctx.cloneExperiment,
    archiveExperiment: ctx.archiveExperiment,
    deleteExperiment: ctx.deleteExperiment,
    changeExperimentStatus: ctx.changeExperimentStatus,
    isLoading: ctx.experimentsLoading,
    isError: ctx.experimentsError,
    reload: ctx.reloadExperiments,
  };
}
