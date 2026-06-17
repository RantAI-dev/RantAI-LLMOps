"use client";

import { FilterBar } from "@/components/ui/filter-bar";
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
    <FilterBar
      ariaLabel="Document filters"
      title="Filter documents"
      searchValue={filters.search}
      onSearchChange={(search) => onChange({ search })}
      searchPlaceholder="Search by file name, knowledge base, or type..."
      searchAriaLabel="Search documents"
      searchClassName={searchFieldClassName}
      active={active}
      onReset={onReset}
      resetLabel="Reset"
      sectionClassName="border-b border-hairline pb-4"
      gridClassName="sm:grid-cols-2 lg:grid-cols-4"
    >
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
    </FilterBar>
  );
}
