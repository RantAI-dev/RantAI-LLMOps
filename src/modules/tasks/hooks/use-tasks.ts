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
    stopTask: ctx.stopTask,
    deleteTask: ctx.deleteTask,
    isLoading: ctx.tasksLoading,
    isError: ctx.tasksError,
    reload: ctx.reloadTasks,
  };
}
