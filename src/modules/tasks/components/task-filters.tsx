"use client";

import { FilterDropdown } from "@/components/ui/filter-dropdown";
import { FilterToolbar } from "@/components/ui/filter-toolbar";
import {
  COMPUTE_TARGETS,
  TASK_STATUSES,
  TASK_TYPES,
  type TaskFilters,
} from "@/modules/tasks/types";

type TaskFiltersBarProps = {
  filters: TaskFilters;
  onChange: (patch: Partial<TaskFilters>) => void;
  onReset: () => void;
};

export function TaskFiltersBar({ filters, onChange }: TaskFiltersBarProps) {
  return (
    <FilterToolbar
      searchValue={filters.search}
      onSearchChange={(search) => onChange({ search })}
      searchPlaceholder="Search"
      searchAriaLabel="Search by task name"
      className="border-b border-hairline pb-4"
    >
      <FilterDropdown
        label="Task type"
        value={filters.type}
        onChange={(v) => onChange({ type: v as TaskFilters["type"] })}
        options={[
          { value: "all", label: "All types", hint: "ALL" },
          ...TASK_TYPES.map((t) => ({ value: t, label: t })),
        ]}
        searchPlaceholder="Type task type…"
      />
      <FilterDropdown
        label="Status"
        value={filters.status}
        onChange={(v) => onChange({ status: v as TaskFilters["status"] })}
        options={[
          { value: "all", label: "All statuses", hint: "ALL" },
          ...TASK_STATUSES.map((s) => ({ value: s, label: s })),
        ]}
        searchPlaceholder="Type status…"
      />
      <FilterDropdown
        label="Compute"
        value={filters.computeTarget}
        onChange={(v) => onChange({ computeTarget: v as TaskFilters["computeTarget"] })}
        options={[
          { value: "all", label: "All targets", hint: "ALL" },
          ...COMPUTE_TARGETS.map((c) => ({ value: c, label: c })),
        ]}
        searchPlaceholder="Type compute…"
      />
      <FilterDropdown
        label="Sort"
        value={filters.sort}
        onChange={(v) => onChange({ sort: v as TaskFilters["sort"] })}
        options={[
          { value: "newest", label: "Newest first", hint: "NEW" },
          { value: "oldest", label: "Oldest first", hint: "OLD" },
          { value: "progress", label: "Progress", hint: "%" },
          { value: "duration", label: "Duration", hint: "TIME" },
        ]}
        searchPlaceholder="Type sort…"
      />
    </FilterToolbar>
  );
}
