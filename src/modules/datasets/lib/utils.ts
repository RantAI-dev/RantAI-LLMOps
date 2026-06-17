import {
  applyRagToNewDataset,
} from "@/modules/datasets/lib/rag-utils";
import type {
  CreateDatasetInput,
  Dataset,
  DatasetReadiness,
  DatasetSplit,
  HuggingFaceDatasetCatalogEntry,
  HuggingFaceDatasetFeature,
  HuggingFaceImportConfig,
  SchemaMappingRow,
  StandardField,
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

export function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatDateTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
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

export function generateDatasetId(): string {
  return `ds-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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

const HF_COLUMN_TO_STANDARD: Record<string, StandardField> = {
  instruction: "instruction",
  prompt: "instruction",
  question: "instruction",
  input: "input/context",
  context: "input/context",
  sentence: "input/context",
  sentence1: "input/context",
  text: "input/context",
  output: "expected_output",
  response: "expected_output",
  answer: "expected_output",
  answers: "expected_output",
  chosen: "expected_output",
  label: "label",
  category: "label",
  metadata: "metadata",
  id: "metadata",
  idx: "metadata",
  title: "metadata",
};

export function buildSchemaMappingFromFeatures(
  features: HuggingFaceDatasetFeature[]
): SchemaMappingRow[] {
  return features.map((feature, index) => {
    const standardField = HF_COLUMN_TO_STANDARD[feature.name] ?? ("" as StandardField | "");
    const required = standardField === "instruction" || standardField === "expected_output";
    return {
      id: `hf-map-${index}-${feature.name}`,
      datasetColumn: feature.name,
      standardField,
      required,
      dataType: feature.dtype,
      exampleValue: feature.example ?? "",
      mappingStatus: standardField ? "Mapped" : "Optional",
    };
  });
}

export function catalogEntryToCreateInput(
  entry: HuggingFaceDatasetCatalogEntry,
  config: HuggingFaceImportConfig
): CreateDatasetInput {
  const datasetConfig =
    entry.configs.find((c) => c.name === config.config) ??
    entry.configs.find((c) => c.default) ??
    entry.configs[0]!;
  const splitInfo =
    datasetConfig.splits.find((s) => s.name === config.split) ?? datasetConfig.splits[0]!;
  const totalRows = config.maxRows ?? splitInfo.numRows;
  const invalidRows = Math.max(1, Math.floor(totalRows * 0.002));
  const schemaMapping = buildSchemaMappingFromFeatures(datasetConfig.features);

  return {
    name: config.name.trim() || entry.datasetName,
    description: config.description.trim() || entry.description,
    datasetType: config.datasetType,
    source: "Hugging Face",
    owner: config.owner,
    tags: config.tags.length > 0 ? config.tags : entry.tags.slice(0, 5),
    accessLevel: config.accessLevel,
    notes: `Imported from Hugging Face: ${entry.repoId} (config=${config.config}, split=${config.split}, revision=${config.revision || "main"})`,
    schemaMapping,
    validationSummary: buildValidationSummary(totalRows, invalidRows),
    issues: [],
    format: config.streaming ? "HF Streaming" : "Parquet / Arrow",
    huggingFaceSource: {
      repoId: entry.repoId,
      repoUrl: `https://huggingface.co/datasets/${entry.repoId}`,
      config: config.config,
      split: config.split,
      revision: config.revision || "main",
      streaming: config.streaming,
      trustRemoteCode: config.trustRemoteCode,
      importMode: config.importMode,
      license: entry.license,
      taskCategories: entry.taskCategories,
    },
  };
}

export function datasetFromCreateInput(input: CreateDatasetInput): Dataset {
  const now = new Date().toISOString();
  const status: ValidationStatus = input.saveAsDraft
    ? "Draft"
    : deriveValidationStatus(
        input.validationSummary.invalidRows,
        0,
        false,
        false
      );

  const dataset: Dataset = {
    id: generateDatasetId(),
    name: input.name,
    description: input.description,
    datasetType: input.datasetType,
    source: input.source,
    currentVersion: "v1",
    totalRows: input.validationSummary.totalRows,
    validRows: input.validationSummary.validRows,
    invalidRows: input.validationSummary.invalidRows,
    validationStatus: status,
    usageCount: 0,
    lastUpdated: now,
    owner: input.owner,
    tags: input.tags,
    accessLevel: input.accessLevel,
    notes: input.notes,
    format: input.format ?? "JSONL",
    createdAt: now,
    schemaMapping: input.schemaMapping,
    validationSummary: input.validationSummary,
    issues: input.issues,
    huggingFaceSource: input.huggingFaceSource ?? null,
    versions: [
      {
        id: generateVersionId(),
        version: "v1",
        changes: "Initial upload",
        rows: input.validationSummary.totalRows,
        validationStatus: status,
        qualityScore: input.validationSummary.dataQualityScore,
        createdBy: input.owner,
        createdAt: now,
        isActive: true,
      },
    ],
    split: { training: 80, validation: 10, testing: 10, evaluation: 0 },
    usage: [],
    activityLog: [
      {
        id: generateActivityId(),
        timestamp: now,
        actor: input.owner,
        activity: input.saveAsDraft ? "Dataset saved as draft" : input.huggingFaceSource ? "Dataset imported from Hugging Face" : "Dataset uploaded",
        description: input.saveAsDraft
          ? `${input.name} saved as draft`
          : input.huggingFaceSource
            ? `${input.name} imported from ${input.huggingFaceSource.repoId}`
            : `${input.name} v1 created`,
      },
    ],
    readiness: {
      fineTuning: "Not Configured",
      evaluation: "Not Configured",
      ragKnowledgeBase: "Not Configured",
      promptTesting: "Not Configured",
      agentBenchmark: "Not Configured",
    },
    rag: applyRagToNewDataset(input),
  };

  dataset.readiness = buildReadiness(dataset);
  return dataset;
}
