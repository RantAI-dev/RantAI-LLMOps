"use client";

import { FilterBar } from "@/components/ui/filter-bar";
import { searchFieldClassName } from "@/modules/datasets/constants/dataset-ui";
import {
  DATASET_SOURCES,
  DATASET_TYPES,
  VALIDATION_STATUSES,
  type DatasetFilters,
} from "@/modules/datasets/types";
import { FilterSelect } from "@/modules/tasks/components/filter-select";

type DatasetFiltersBarProps = {
  filters: DatasetFilters;
  onChange: (patch: Partial<DatasetFilters>) => void;
  onReset: () => void;
};

const hasActive = (f: DatasetFilters) =>
  f.search.trim() !== "" ||
  f.datasetType !== "all" ||
  f.source !== "all" ||
  f.validationStatus !== "all" ||
  f.sort !== "updated";

export function DatasetFiltersBar({ filters, onChange, onReset }: DatasetFiltersBarProps) {
  const active = hasActive(filters);

  return (
    <FilterBar
      ariaLabel="Dataset filters"
      title="Filter datasets"
      searchValue={filters.search}
      onSearchChange={(search) => onChange({ search })}
      searchPlaceholder="Search by dataset name, owner, or tags..."
      searchAriaLabel="Search datasets"
      searchClassName={searchFieldClassName}
      active={active}
      onReset={onReset}
      sectionClassName="border-b border-hairline pb-4"
      gridClassName="sm:grid-cols-2 lg:grid-cols-4"
    >
      <FilterSelect
            showLabel
            label="Dataset type"
            value={filters.datasetType}
            onChange={(v) => onChange({ datasetType: v as DatasetFilters["datasetType"] })}
            options={[
              { value: "all", label: "All types" },
              ...DATASET_TYPES.map((t) => ({ value: t, label: t })),
            ]}
          />
          <FilterSelect
            showLabel
            label="Source"
            value={filters.source}
            onChange={(v) => onChange({ source: v as DatasetFilters["source"] })}
            options={[
              { value: "all", label: "All sources" },
              ...DATASET_SOURCES.map((s) => ({ value: s, label: s })),
            ]}
          />
          <FilterSelect
            showLabel
            label="Status"
            value={filters.validationStatus}
            onChange={(v) =>
              onChange({ validationStatus: v as DatasetFilters["validationStatus"] })
            }
            options={[
              { value: "all", label: "All statuses" },
              ...VALIDATION_STATUSES.map((s) => ({ value: s, label: s })),
            ]}
          />
          <FilterSelect
            showLabel
            label="Sort"
            value={filters.sort}
            onChange={(v) => onChange({ sort: v as DatasetFilters["sort"] })}
            options={[
              { value: "updated", label: "Last updated" },
              { value: "newest", label: "Newest" },
              { value: "oldest", label: "Oldest" },
              { value: "name", label: "Name (A–Z)" },
              { value: "usage", label: "Usage count" },
            ]}
          />
    </FilterBar>
  );
}
