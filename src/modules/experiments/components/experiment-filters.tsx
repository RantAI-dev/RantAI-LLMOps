import { FilterBar } from "@/components/ui/filter-bar";
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
    <FilterBar
      ariaLabel="Experiment filters"
      title="Filter experiments"
      searchValue={filters.search}
      onSearchChange={(search) => onChange({ search })}
      searchPlaceholder="Search by experiment name or owner..."
      searchAriaLabel="Search experiments"
      searchClassName={searchFieldClassName}
      active={active}
      onReset={onReset}
      gridClassName="sm:grid-cols-2 lg:grid-cols-4"
    >
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
    </FilterBar>
  );
}
