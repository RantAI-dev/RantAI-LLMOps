"use client";

import { FilterDropdown } from "@/components/ui/filter-dropdown";
import { FilterToolbar } from "@/components/ui/filter-toolbar";
import {
  DATASET_SOURCES,
  DATASET_TYPES,
  VALIDATION_STATUSES,
  type DatasetFilters,
} from "@/modules/datasets/types";

type DatasetFiltersBarProps = {
  filters: DatasetFilters;
  onChange: (patch: Partial<DatasetFilters>) => void;
  onReset: () => void;
};

export function DatasetFiltersBar({ filters, onChange }: DatasetFiltersBarProps) {
  return (
    <FilterToolbar
      searchValue={filters.search}
      onSearchChange={(search) => onChange({ search })}
      searchPlaceholder="Search"
      searchAriaLabel="Search datasets"
      className="border-b border-hairline pb-4"
    >
      <FilterDropdown
        label="Dataset type"
        value={filters.datasetType}
        onChange={(v) => onChange({ datasetType: v as DatasetFilters["datasetType"] })}
        options={[
          { value: "all", label: "All types", hint: "ALL" },
          ...DATASET_TYPES.map((t) => ({ value: t, label: t })),
        ]}
        searchPlaceholder="Type dataset type…"
      />
      <FilterDropdown
        label="Source"
        value={filters.source}
        onChange={(v) => onChange({ source: v as DatasetFilters["source"] })}
        options={[
          { value: "all", label: "All sources", hint: "ALL" },
          ...DATASET_SOURCES.map((s) => ({ value: s, label: s })),
        ]}
        searchPlaceholder="Type source…"
      />
      <FilterDropdown
        label="Status"
        value={filters.validationStatus}
        onChange={(v) =>
          onChange({ validationStatus: v as DatasetFilters["validationStatus"] })
        }
        options={[
          { value: "all", label: "All statuses", hint: "ALL" },
          ...VALIDATION_STATUSES.map((s) => ({ value: s, label: s })),
        ]}
        searchPlaceholder="Type status…"
      />
      <FilterDropdown
        label="Sort"
        value={filters.sort}
        onChange={(v) => onChange({ sort: v as DatasetFilters["sort"] })}
        options={[
          { value: "updated", label: "Last updated", hint: "UPD" },
          { value: "newest", label: "Newest", hint: "NEW" },
          { value: "oldest", label: "Oldest", hint: "OLD" },
          { value: "name", label: "Name (A–Z)", hint: "A–Z" },
          { value: "usage", label: "Usage count", hint: "USE" },
        ]}
        searchPlaceholder="Type sort…"
      />
    </FilterToolbar>
  );
}
