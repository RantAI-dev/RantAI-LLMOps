import { APP_TIME_ZONE, parseTlDate } from "@/lib/tl-datetime";
import type {
  Dataset,
  DatasetReadiness,
  DatasetSplit,
  ValidationStatus,
  ValidationSummary,
} from "@/modules/datasets/types";

export const statusStyles: Record<
  ValidationStatus,
  { bg: string; text: string; dot: string }
> = {
  Draft: { bg: "bg-surface-2", text: "text-ink-strong", dot: "bg-ink-faint" },
  Uploaded: { bg: "bg-info-soft", text: "text-info-strong", dot: "bg-info-solid" },
  Validating: { bg: "bg-primary-tint", text: "text-primary-strong", dot: "bg-warning-solid" },
  "Needs Review": { bg: "bg-warning-soft-2", text: "text-warning", dot: "bg-warning-solid" },
  Ready: { bg: "bg-success-soft", text: "text-success", dot: "bg-success-solid" },
  "In Use": { bg: "bg-purple-soft", text: "text-purple-strong", dot: "bg-purple-solid" },
  Archived: { bg: "bg-surface-2", text: "text-ink-faint-strong", dot: "bg-ink-faint" },
  Error: { bg: "bg-danger-soft", text: "text-danger", dot: "bg-danger-solid" },
};

/** Copy-on-write update of a single dataset by id (no-op if not found). */
export function updateDataset(
  datasets: Dataset[],
  id: string,
  updater: (d: Dataset) => Dataset
): Dataset[] {
  return datasets.map((d) => (d.id === id ? updater(d) : d));
}

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatDateTime(iso: string): string {
  const d = parseTlDate(iso);
  if (!d) return iso || "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: APP_TIME_ZONE,
  }).format(d);
}

export function formatDate(iso: string): string {
  const d = parseTlDate(iso);
  if (!d) return iso || "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: APP_TIME_ZONE,
  }).format(d);
}

export function computeQualityScore(validRows: number, totalRows: number): number {
  if (totalRows <= 0) return 0;
  return Math.round((validRows / totalRows) * 100);
}

export function deriveValidationStatus(
  invalidRows: number,
  usageCount: number,
  archived?: boolean,
  error?: boolean
): ValidationStatus {
  if (archived) return "Archived";
  if (error) return "Error";
  if (usageCount > 0 && invalidRows === 0) return "In Use";
  if (invalidRows > 0) return "Needs Review";
  return "Ready";
}

export function buildValidationSummary(
  totalRows: number,
  invalidRows: number,
  overrides?: Partial<ValidationSummary>
): ValidationSummary {
  const validRows = Math.max(0, totalRows - invalidRows);
  return {
    totalRows,
    validRows,
    invalidRows,
    duplicateRows: overrides?.duplicateRows ?? Math.floor(invalidRows * 0.4),
    missingValues: overrides?.missingValues ?? Math.floor(invalidRows * 0.35),
    piiDetected: overrides?.piiDetected ?? Math.floor(invalidRows * 0.15),
    toxicContent: overrides?.toxicContent ?? Math.floor(invalidRows * 0.1),
    dataQualityScore: computeQualityScore(validRows, totalRows),
    ...overrides,
  };
}

export function buildReadiness(
  dataset: Pick<Dataset, "datasetType" | "validationStatus" | "invalidRows">
): DatasetReadiness {
  const ready = dataset.validationStatus === "Ready" || dataset.validationStatus === "In Use";
  const needReview =
    dataset.validationStatus === "Needs Review" || dataset.invalidRows > 0;
  const level = (configured: boolean): DatasetReadiness[keyof DatasetReadiness] => {
    if (!configured) return "Not Configured";
    if (needReview) return "Need Review";
    if (ready) return "Ready";
    return "Not Configured";
  };

  return {
    fineTuning: level(
      dataset.datasetType === "Training Dataset" || dataset.datasetType === "Evaluation Dataset"
    ),
    evaluation: level(dataset.datasetType === "Evaluation Dataset"),
    ragKnowledgeBase: level(dataset.datasetType === "RAG Knowledge Base"),
    promptTesting: level(dataset.datasetType === "Prompt Test Dataset"),
    agentBenchmark: level(dataset.datasetType === "Agent Benchmark Dataset"),
  };
}

export function splitRowCounts(totalRows: number, split: DatasetSplit) {
  const training = Math.round((totalRows * split.training) / 100);
  const validation = Math.round((totalRows * split.validation) / 100);
  const testing = Math.round((totalRows * split.testing) / 100);
  const evaluation = Math.round((totalRows * split.evaluation) / 100);
  return { training, validation, testing, evaluation };
}

export function splitTotal(split: DatasetSplit): number {
  return split.training + split.validation + split.testing + split.evaluation;
}

export function generateActivityId(): string {
  return `ds-act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function generateVersionId(): string {
  return `ds-ver-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function sourceLabel(source: Dataset["source"]): string {
  switch (source) {
    case "File Upload":
      return "CSV Upload";
    case "Hugging Face":
      return "Hugging Face";
    case "Cloud Storage":
      return "Cloud Storage";
    case "Database":
      return "Database";
    case "API":
      return "API";
    case "Manual Input":
      return "Manual";
    default:
      return source;
  }
}

