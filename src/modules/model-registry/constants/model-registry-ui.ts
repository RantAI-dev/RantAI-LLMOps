import { textUi } from "@/lib/text-ui";

export const modelRegistryUi = textUi;

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
