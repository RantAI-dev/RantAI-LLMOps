"use client";

import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    <section className="space-y-3 border-b border-hairline pb-4" aria-label="Dataset filters">
      <div className="relative w-full max-w-xl">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-primary"
          aria-hidden
        />
        <Input
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
          placeholder="Search by dataset name, owner, or tags..."
          className={searchFieldClassName}
          aria-label="Search datasets"
        />
      </div>

      <div className="rounded-lg border border-hairline bg-surface p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-ink">
            <SlidersHorizontal className="size-4 text-primary" aria-hidden />
            <span className="text-[13px] font-medium">Filter datasets</span>
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
            Reset filter
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
        </div>
      </div>
    </section>
  );
}
