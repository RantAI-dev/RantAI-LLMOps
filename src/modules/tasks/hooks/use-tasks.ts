"use client";

import { useLlmOps } from "@/modules/llm-ops/context/llm-ops-provider";

export function useTasks() {
  const ctx = useLlmOps();

  return {
    tasks: ctx.tasks,
    experiments: ctx.experiments,
    filteredTasks: ctx.filteredTasks,
    filters: ctx.taskFilters,
    setFilters: ctx.setTaskFilters,
    resetFilters: ctx.resetTaskFilters,
    selectedTask: ctx.selectedTask,
    selectedTaskId: ctx.selectedTaskId,
    setSelectedTaskId: ctx.setSelectedTaskId,
    isCreateOpen: ctx.isCreateTaskOpen,
    setIsCreateOpen: (open: boolean) => {
      if (open) ctx.openCreateTask(ctx.createTaskPresetExperimentId ?? undefined);
      else ctx.closeCreateTask();
    },
    openCreateTask: ctx.openCreateTask,
    createTaskPresetExperimentId: ctx.createTaskPresetExperimentId,
    createTask: ctx.createTask,
    startTask: ctx.startTask,
    pauseTask: ctx.pauseTask,
    stopTask: ctx.stopTask,
    retryTask: ctx.retryTask,
    cloneTask: ctx.cloneTask,
    deleteTask: ctx.deleteTask,
  };
}
