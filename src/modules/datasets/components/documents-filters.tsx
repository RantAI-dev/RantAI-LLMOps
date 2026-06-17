"use client";

import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  defaultDocumentsFilters,
  type DocumentsFilters,
} from "@/modules/datasets/constants/documents-ui";
import { searchFieldClassName } from "@/modules/datasets/constants/dataset-ui";
import type { Dataset } from "@/modules/datasets/types";
import { RAG_DOCUMENT_STATUSES, RAG_INDEX_STATUSES } from "@/modules/datasets/types";
import { FilterSelect } from "@/modules/tasks/components/filter-select";

type DocumentsFiltersBarProps = {
  filters: DocumentsFilters;
  knowledgeBases: Dataset[];
  onChange: (patch: Partial<DocumentsFilters>) => void;
  onReset: () => void;
};

const hasActive = (f: DocumentsFilters) =>
  f.search.trim() !== "" ||
  f.knowledgeBase !== "all" ||
  f.documentStatus !== "all" ||
  f.indexStatus !== "all" ||
  f.sort !== defaultDocumentsFilters.sort;

export function DocumentsFiltersBar({
  filters,
  knowledgeBases,
  onChange,
  onReset,
}: DocumentsFiltersBarProps) {
  const active = hasActive(filters);

  return (
    <section className="space-y-3 border-b border-hairline pb-4" aria-label="Document filters">
      <div className="relative w-full max-w-xl">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-primary"
          aria-hidden
        />
        <Input
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
          placeholder="Search by file name, knowledge base, or type..."
          className={searchFieldClassName}
          aria-label="Search documents"
        />
      </div>

      <div className="rounded-lg border border-hairline bg-surface p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-ink">
            <SlidersHorizontal className="size-4 text-primary" aria-hidden />
            <span className="text-[13px] font-medium">Filter documents</span>
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
            className="h-8 shrink-0 gap-1.5"
          >
            <RotateCcw className="size-3.5" />
            Reset
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect
            showLabel
            label="Knowledge base"
            value={filters.knowledgeBase}
            onChange={(v) => onChange({ knowledgeBase: v })}
            options={[
              { value: "all", label: "All knowledge bases" },
              ...knowledgeBases.map((kb) => ({ value: kb.id, label: kb.name })),
            ]}
          />
          <FilterSelect
            showLabel
            label="Document status"
            value={filters.documentStatus}
            onChange={(v) => onChange({ documentStatus: v as DocumentsFilters["documentStatus"] })}
            options={[
              { value: "all", label: "All statuses" },
              ...RAG_DOCUMENT_STATUSES.map((s) => ({ value: s, label: s })),
            ]}
          />
          <FilterSelect
            showLabel
            label="Index status"
            value={filters.indexStatus}
            onChange={(v) => onChange({ indexStatus: v as DocumentsFilters["indexStatus"] })}
            options={[
              { value: "all", label: "All index states" },
              ...RAG_INDEX_STATUSES.map((s) => ({ value: s, label: s })),
            ]}
          />
          <FilterSelect
            showLabel
            label="Sort"
            value={filters.sort}
            onChange={(v) => onChange({ sort: v as DocumentsFilters["sort"] })}
            options={[
              { value: "newest", label: "Newest upload" },
              { value: "oldest", label: "Oldest upload" },
              { value: "name", label: "Name (A–Z)" },
              { value: "size", label: "Largest file" },
            ]}
          />
        </div>
      </div>
    </section>
  );
}
