export const modelRegistryUi = {
  body: "text-sm leading-5",
  title: "text-2xl font-semibold leading-8 tracking-tight",
  subheading: "text-base leading-6 text-ink-soft",
  section: "text-lg font-semibold leading-7 tracking-tight",
  detailTitle: "text-lg font-semibold leading-tight text-primary",
  metric: "text-2xl font-semibold leading-8 tabular-nums tracking-tight",
  label: "text-xs font-medium text-ink-soft",
} as const;

export {
  fieldClassName,
  searchFieldClassName,
  filterSelectClassName,
  filterSelectClassName as selectClassName,
} from "@/modules/tasks/constants/task-ui";

export const DETAIL_TABS = [
  { id: "overview", label: "Overview" },
  { id: "huggingface", label: "Hugging Face Source" },
  { id: "files", label: "Files" },
  { id: "compatibility", label: "Compatibility" },
  { id: "deployment", label: "Deployment" },
  { id: "evaluation", label: "Evaluation" },
  { id: "usage", label: "Usage & Monitoring" },
  { id: "audit", label: "Audit Log" },
] as const;

export const IMPORT_STEPS = [
  "Connect Hugging Face",
  "Search Model",
  "Preview Model",
  "Import Configuration",
  "Import Progress",
] as const;

export const panelClassName = "rounded-lg border border-hairline bg-surface";
export const tableWrapClassName = "overflow-x-auto rounded-lg border border-hairline bg-white";

export const IMPORT_PROGRESS_STEPS = [
  "Checking Access",
  "Checking License",
  "Checking Files",
  "Downloading Metadata",
  "Downloading Model Files",
  "Registering Model",
  "Validating Compatibility",
  "Import Completed",
] as const;

export const IMPORT_VALIDATION_CHECKS = [
  "Access check",
  "License check",
  "File check",
  "Config check",
  "Tokenizer check",
  "Compatibility check",
  "Storage check",
  "Hardware requirement check",
] as const;
