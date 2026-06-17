import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchFieldClassName } from "@/modules/tasks/constants/task-ui";
import {
  BASE_MODELS,
  DATASETS,
  EXPERIMENT_STATUSES,
  type ExperimentFilters,
} from "@/modules/experiments/types";

import { FilterSelect } from "@/modules/tasks/components/filter-select";

type ExperimentFiltersBarProps = {
  filters: ExperimentFilters;
  onChange: (patch: Partial<ExperimentFilters>) => void;
  onReset: () => void;
};

const hasActive = (f: ExperimentFilters) =>
  f.search.trim() !== "" ||
  f.status !== "all" ||
  f.baseModel !== "all" ||
  f.dataset !== "all" ||
  f.sort !== "newest";

export function ExperimentFiltersBar({ filters, onChange, onReset }: ExperimentFiltersBarProps) {
  const active = hasActive(filters);

  return (
    <section className="space-y-3" aria-label="Experiment filters">
      <div className="relative w-full max-w-xl">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-primary" aria-hidden />
        <Input
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
          placeholder="Search by experiment name or owner..."
          className={searchFieldClassName}
          aria-label="Search experiments"
        />
      </div>

      <div className="rounded-lg border border-hairline bg-surface p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-ink">
            <SlidersHorizontal className="size-4 text-primary" aria-hidden />
            <span className="text-[13px] font-medium">Filter experiments</span>
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
            className="h-8 gap-1.5 border-hairline bg-white px-3 text-ink disabled:opacity-40"
          >
            <RotateCcw className="size-3.5 text-primary" />
            Reset filter
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect
            showLabel
            label="Status"
            value={filters.status}
            onChange={(v) => onChange({ status: v as ExperimentFilters["status"] })}
            options={[
              { value: "all", label: "All statuses" },
              ...EXPERIMENT_STATUSES.map((s) => ({ value: s, label: s })),
            ]}
          />
          <FilterSelect
            showLabel
            label="Base model"
            value={filters.baseModel}
            onChange={(v) => onChange({ baseModel: v })}
            options={[{ value: "all", label: "All models" }, ...BASE_MODELS.map((m) => ({ value: m, label: m }))]}
          />
          <FilterSelect
            showLabel
            label="Dataset"
            value={filters.dataset}
            onChange={(v) => onChange({ dataset: v })}
            options={[{ value: "all", label: "All datasets" }, ...DATASETS.map((d) => ({ value: d, label: d }))]}
          />
          <FilterSelect
            showLabel
            label="Sort"
            value={filters.sort}
            onChange={(v) => onChange({ sort: v as ExperimentFilters["sort"] })}
            options={[
              { value: "newest", label: "Newest" },
              { value: "oldest", label: "Oldest" },
              { value: "updated", label: "Last updated" },
              { value: "most-tasks", label: "Most tasks" },
              { value: "best-score", label: "Best score" },
            ]}
          />
        </div>
      </div>
    </section>
  );
}
