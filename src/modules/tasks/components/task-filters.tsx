import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchFieldClassName } from "@/modules/tasks/constants/task-ui";
import { useLlmOps } from "@/modules/llm-ops/context/llm-ops-provider";
import {
  COMPUTE_TARGETS,
  TASK_STATUSES,
  TASK_TYPES,
  type TaskFilters,
} from "@/modules/tasks/types";

import { FilterSelect } from "./filter-select";

type TaskFiltersBarProps = {
  filters: TaskFilters;
  onChange: (patch: Partial<TaskFilters>) => void;
  onReset: () => void;
};

const hasActiveFilters = (filters: TaskFilters) =>
  filters.search.trim() !== "" ||
  filters.experiment !== "all" ||
  filters.type !== "all" ||
  filters.status !== "all" ||
  filters.computeTarget !== "all" ||
  filters.sort !== "newest";

export function TaskFiltersBar({ filters, onChange, onReset }: TaskFiltersBarProps) {
  const { experiments } = useLlmOps();
  const active = hasActiveFilters(filters);

  return (
    <section className="space-y-3 border-b border-hairline pb-4" aria-label="Task filters">
      <div className="relative w-full max-w-xl">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-primary"
          aria-hidden
        />
        <Input
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
          placeholder="Search by task or experiment name..."
          className={searchFieldClassName}
          aria-label="Search by task or experiment name"
        />
      </div>

      <div className="rounded-lg border border-hairline bg-surface p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-ink">
            <SlidersHorizontal className="size-4 text-primary" aria-hidden />
            <span className="text-[13px] font-medium">Filter tasks</span>
            {active ? (
              <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary">
                Active
              </span>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onReset}
            disabled={!active}
            className="h-8 shrink-0 gap-1.5 border-hairline bg-white px-3 text-ink hover:border-primary/30 hover:bg-primary-tint-2 hover:text-primary disabled:opacity-40"
          >
            <RotateCcw className="size-3.5 text-primary" />
            Reset
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <FilterSelect
            showLabel
            label="Experiment"
            value={filters.experiment}
            onChange={(v) => onChange({ experiment: v })}
            options={[
              { value: "all", label: "All experiments" },
              ...experiments.map((e) => ({ value: e.id, label: e.name })),
            ]}
            className="sm:col-span-2 lg:col-span-1"
          />
          <FilterSelect
            showLabel
            label="Task type"
            value={filters.type}
            onChange={(v) => onChange({ type: v as TaskFilters["type"] })}
            options={[
              { value: "all", label: "All types" },
              ...TASK_TYPES.map((t) => ({ value: t, label: t })),
            ]}
          />
          <FilterSelect
            showLabel
            label="Status"
            value={filters.status}
            onChange={(v) => onChange({ status: v as TaskFilters["status"] })}
            options={[
              { value: "all", label: "All statuses" },
              ...TASK_STATUSES.map((s) => ({ value: s, label: s })),
            ]}
          />
          <FilterSelect
            showLabel
            label="Compute"
            value={filters.computeTarget}
            onChange={(v) => onChange({ computeTarget: v as TaskFilters["computeTarget"] })}
            options={[
              { value: "all", label: "All targets" },
              ...COMPUTE_TARGETS.map((c) => ({ value: c, label: c })),
            ]}
          />
          <FilterSelect
            showLabel
            label="Sort"
            value={filters.sort}
            onChange={(v) => onChange({ sort: v as TaskFilters["sort"] })}
            options={[
              { value: "newest", label: "Newest first" },
              { value: "oldest", label: "Oldest first" },
              { value: "progress", label: "Progress" },
              { value: "duration", label: "Duration" },
            ]}
          />
        </div>
      </div>
    </section>
  );
}
