import { textUi } from "@/lib/text-ui";

export const datasetUi = textUi;

export {
  fieldClassName,
  searchFieldClassName,
  filterSelectClassName,
  filterSelectClassName as selectClassName,
} from "@/modules/tasks/constants/task-ui";

export const WIZARD_STEPS = [
  "Select Source",
  "Dataset Info",
  "Preview Data",
  "Schema Mapping",
  "Validation Result",
  "Save Dataset",
] as const;

export const HF_IMPORT_STEPS = [
  "Connect Token",
  "Search Dataset",
  "Preview Dataset",
  "Configure Import",
  "Import Progress",
] as const;

export const HF_IMPORT_VALIDATION_CHECKS = [
  "Repository access verified",
  "Config name validated",
  "Split availability confirmed",
  "Schema features mapped",
  "License accepted",
] as const;

// Only tabs backed by REAL data are listed. Schema mapping, version history,
// split editor, usage/lineage, activity log, and the RAG subsystem were demo-only
// (no Transformer Lab backend) and have been removed.
export const DETAIL_TABS = [
  { id: "overview", label: "Overview" },
  { id: "preview", label: "Preview" },
  { id: "huggingface", label: "Hugging Face Source" },
] as const;

export const RAG_INDEX_STATUS_STYLES: Record<
  string,
  { bg: string; text: string }
> = {
  "Not Indexed": { bg: "bg-surface-2", text: "text-ink-faint-strong" },
  Indexing: { bg: "bg-primary-tint", text: "text-primary-strong" },
  Ready: { bg: "bg-success-soft", text: "text-success" },
  Stale: { bg: "bg-warning-soft-2", text: "text-warning" },
  Failed: { bg: "bg-danger-soft", text: "text-danger" },
};

export const panelClassName = "rounded-lg border border-hairline bg-surface";
export const tableWrapClassName = "overflow-x-auto rounded-lg border border-hairline bg-white";
