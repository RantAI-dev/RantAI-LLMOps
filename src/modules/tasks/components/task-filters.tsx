import { FilterBar } from "@/components/ui/filter-bar";
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
    <FilterBar
      ariaLabel="Task filters"
      title="Filter tasks"
      searchValue={filters.search}
      onSearchChange={(search) => onChange({ search })}
      searchPlaceholder="Search by task or experiment name..."
      searchAriaLabel="Search by task or experiment name"
      searchClassName={searchFieldClassName}
      active={active}
      onReset={onReset}
      resetLabel="Reset"
      sectionClassName="border-b border-hairline pb-4"
      gridClassName="sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
    >
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
    </FilterBar>
  );
}
