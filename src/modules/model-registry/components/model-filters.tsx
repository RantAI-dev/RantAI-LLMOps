"use client";

import { RotateCcw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { searchFieldClassName } from "@/modules/model-registry/constants/model-registry-ui";
import { FilterSelect } from "@/modules/tasks/components/filter-select";
import {
  ACCESS_TYPES,
  MODEL_PROVIDERS,
  MODEL_STATUSES,
  MODEL_TASKS,
} from "@/modules/model-registry/types";
import type { ModelFilters } from "@/modules/model-registry/types";
import { cn } from "@/lib/utils";

type ModelFiltersBarProps = {
  filters: ModelFilters;
  onChange: (patch: Partial<ModelFilters>) => void;
  onReset: () => void;
};

export function ModelFiltersBar({ filters, onChange, onReset }: ModelFiltersBarProps) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-primary" />
        <Input
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
          placeholder="Search by model name, repo ID, provider, or tag..."
          className={cn(searchFieldClassName, "pl-9")}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
        <FilterSelect
          label="Provider"
          value={filters.provider}
          onChange={(v) => onChange({ provider: v as ModelFilters["provider"] })}
          options={[{ value: "all", label: "All Providers" }, ...MODEL_PROVIDERS.map((p) => ({ value: p, label: p }))]}
        />
        <FilterSelect
          label="Task"
          value={filters.task}
          onChange={(v) => onChange({ task: v as ModelFilters["task"] })}
          options={[{ value: "all", label: "All Tasks" }, ...MODEL_TASKS.map((t) => ({ value: t, label: t }))]}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => onChange({ status: v as ModelFilters["status"] })}
          options={[{ value: "all", label: "All Statuses" }, ...MODEL_STATUSES.map((s) => ({ value: s, label: s }))]}
        />
        <FilterSelect
          label="Access"
          value={filters.access}
          onChange={(v) => onChange({ access: v as ModelFilters["access"] })}
          options={[{ value: "all", label: "All Access" }, ...ACCESS_TYPES.map((a) => ({ value: a, label: a }))]}
        />
        <FilterSelect
          label="Compatibility"
          value={filters.compatibility}
          onChange={(v) => onChange({ compatibility: v as ModelFilters["compatibility"] })}
          options={[
            { value: "all", label: "All" },
            { value: "vLLM Compatible", label: "vLLM Compatible" },
            { value: "Need Review", label: "Need Review" },
            { value: "Not Supported", label: "Not Supported" },
          ]}
        />
        <div className="flex items-end">
          <Button type="button" variant="outline" className="w-full" onClick={onReset}>
            <RotateCcw className="size-4" />
            Reset
          </Button>
        </div>
      </div>
    </div>
  );
}
