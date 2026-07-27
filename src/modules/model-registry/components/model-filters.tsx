"use client";

import { FilterDropdown } from "@/components/ui/filter-dropdown";
import { FilterToolbar } from "@/components/ui/filter-toolbar";
import {
  ACCESS_TYPES,
  MODEL_PROVIDERS,
  MODEL_STATUSES,
  MODEL_TASKS,
  type ModelFilters,
} from "@/modules/model-registry/types";

type ModelFiltersBarProps = {
  filters: ModelFilters;
  onChange: (patch: Partial<ModelFilters>) => void;
  onReset: () => void;
};

export function ModelFiltersBar({ filters, onChange }: ModelFiltersBarProps) {
  return (
    <FilterToolbar
      searchValue={filters.search}
      onSearchChange={(search) => onChange({ search })}
      searchPlaceholder="Search"
      searchAriaLabel="Search models"
      className="border-b border-hairline pb-4"
    >
      <FilterDropdown
        label="Provider"
        value={filters.provider}
        onChange={(v) => onChange({ provider: v as ModelFilters["provider"] })}
        options={[
          { value: "all", label: "All Providers", hint: "ALL" },
          ...MODEL_PROVIDERS.map((p) => ({ value: p, label: p })),
        ]}
        searchPlaceholder="Type provider…"
      />
      <FilterDropdown
        label="Task"
        value={filters.task}
        onChange={(v) => onChange({ task: v as ModelFilters["task"] })}
        options={[
          { value: "all", label: "All Tasks", hint: "ALL" },
          ...MODEL_TASKS.map((t) => ({ value: t, label: t })),
        ]}
        searchPlaceholder="Type task…"
      />
      <FilterDropdown
        label="Status"
        value={filters.status}
        onChange={(v) => onChange({ status: v as ModelFilters["status"] })}
        options={[
          { value: "all", label: "All Statuses", hint: "ALL" },
          ...MODEL_STATUSES.map((s) => ({ value: s, label: s })),
        ]}
        searchPlaceholder="Type status…"
      />
      <FilterDropdown
        label="Access"
        value={filters.access}
        onChange={(v) => onChange({ access: v as ModelFilters["access"] })}
        options={[
          { value: "all", label: "All Access", hint: "ALL" },
          ...ACCESS_TYPES.map((a) => ({ value: a, label: a })),
        ]}
        searchPlaceholder="Type access…"
      />
      <FilterDropdown
        label="Compatibility"
        value={filters.compatibility}
        onChange={(v) => onChange({ compatibility: v as ModelFilters["compatibility"] })}
        options={[
          { value: "all", label: "All", hint: "ALL" },
          { value: "vLLM Compatible", label: "vLLM Compatible", hint: "OK" },
          { value: "Need Review", label: "Need Review", hint: "REV" },
          { value: "Not Supported", label: "Not Supported", hint: "NO" },
        ]}
        searchPlaceholder="Type compatibility…"
      />
    </FilterToolbar>
  );
}
