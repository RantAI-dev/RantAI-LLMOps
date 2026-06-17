export const DATASET_TYPES = [
  "Training Dataset",
  "Evaluation Dataset",
  "RAG Knowledge Base",
  "Prompt Test Dataset",
  "Agent Benchmark Dataset",
] as const;

export const DATASET_SOURCES = [
  "File Upload",
  "Hugging Face",
  "Database",
  "API",
  "Cloud Storage",
  "Manual Input",
] as const;

export const HF_ACCESS_TYPES = ["Public", "Private", "Gated"] as const;

export const HF_TOKEN_STATUSES = ["Not Connected", "Valid", "Invalid", "Expired"] as const;

export const HF_IMPORT_MODES = ["Full Download", "Streaming", "Metadata Only"] as const;

export const VALIDATION_STATUSES = [
  "Draft",
  "Uploaded",
  "Validating",
  "Needs Review",
  "Ready",
  "In Use",
  "Archived",
  "Error",
] as const;

export const ACCESS_LEVELS = ["Private", "Team", "Organization"] as const;

export const STANDARD_FIELDS = [
  "instruction",
  "input/context",
  "expected_output",
  "label",
  "metadata",
] as const;

export const ISSUE_TYPES = [
  "Missing Value",
  "Duplicate",
  "Invalid Format",
  "PII Detected",
  "Toxic Content",
  "Schema Mismatch",
] as const;

export const ISSUE_SEVERITIES = ["Low", "Medium", "High"] as const;

export const ISSUE_ACTIONS = ["Review", "Ignore", "Remove Row", "Mask PII"] as const;

export const MAPPING_STATUSES = ["Mapped", "Missing", "Optional", "Error"] as const;

export const READINESS_LEVELS = ["Ready", "Need Review", "Not Configured"] as const;

export type DatasetType = (typeof DATASET_TYPES)[number];
export type DatasetSource = (typeof DATASET_SOURCES)[number];
export type HuggingFaceAccessType = (typeof HF_ACCESS_TYPES)[number];
export type HuggingFaceTokenStatus = (typeof HF_TOKEN_STATUSES)[number];
export type HuggingFaceImportMode = (typeof HF_IMPORT_MODES)[number];
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
export type StandardField = (typeof STANDARD_FIELDS)[number];
export type IssueType = (typeof ISSUE_TYPES)[number];
export type IssueSeverity = (typeof ISSUE_SEVERITIES)[number];
export type IssueAction = (typeof ISSUE_ACTIONS)[number];
export type MappingStatus = (typeof MAPPING_STATUSES)[number];
export type ReadinessLevel = (typeof READINESS_LEVELS)[number];

export type SchemaMappingRow = {
  id: string;
  datasetColumn: string;
  standardField: StandardField | "";
  required: boolean;
  dataType: string;
  exampleValue: string;
  mappingStatus: MappingStatus;
};

export type ValidationIssue = {
  id: string;
  rowNumber: number;
  issueType: IssueType;
  column: string;
  description: string;
  severity: IssueSeverity;
  action: IssueAction;
};

export type ValidationSummary = {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  missingValues: number;
  piiDetected: number;
  toxicContent: number;
  dataQualityScore: number;
};

export type DatasetVersion = {
  id: string;
  version: string;
  changes: string;
  rows: number;
  validationStatus: ValidationStatus;
  qualityScore: number;
  createdBy: string;
  createdAt: string;
  isActive: boolean;
};

export type DatasetUsageItem = {
  id: string;
  category:
    | "Fine-tuning Jobs"
    | "Evaluation Runs"
    | "Prompt Tests"
    | "RAG Knowledge Base"
    | "Agent Benchmark"
    | "Experiments";
  title: string;
  status: string;
  datasetVersion: string;
  usedSince: string;
  result?: string;
};

export type DatasetActivity = {
  id: string;
  timestamp: string;
  actor: string;
  activity: string;
  description: string;
};

export type DatasetSplit = {
  training: number;
  validation: number;
  testing: number;
  evaluation: number;
};

export type DatasetReadiness = {
  fineTuning: ReadinessLevel;
  evaluation: ReadinessLevel;
  ragKnowledgeBase: ReadinessLevel;
  promptTesting: ReadinessLevel;
  agentBenchmark: ReadinessLevel;
};

export type HuggingFaceDatasetFeature = {
  name: string;
  dtype: string;
  example?: string;
};

export type HuggingFaceDatasetSplit = {
  name: string;
  numRows: number;
};

export type HuggingFaceDatasetConfig = {
  name: string;
  default?: boolean;
  splits: HuggingFaceDatasetSplit[];
  features: HuggingFaceDatasetFeature[];
};

export type HuggingFaceDatasetCatalogEntry = {
  repoId: string;
  datasetName: string;
  author: string;
  description: string;
  taskCategories: string[];
  license: string;
  accessType: HuggingFaceAccessType;
  downloads: number;
  likes: number;
  lastModified: string;
  tags: string[];
  gated: boolean;
  private: boolean;
  sizeCategory: string;
  requiresTrustRemoteCode: boolean;
  configs: HuggingFaceDatasetConfig[];
  defaultConfig: string;
};

export type HuggingFaceDatasetSource = {
  repoId: string;
  repoUrl: string;
  config: string;
  split: string;
  revision: string;
  streaming: boolean;
  trustRemoteCode: boolean;
  importMode: HuggingFaceImportMode;
  license: string;
  taskCategories: string[];
};

export type HuggingFaceImportConfig = {
  config: string;
  split: string;
  revision: string;
  streaming: boolean;
  trustRemoteCode: boolean;
  importMode: HuggingFaceImportMode;
  maxRows: number | null;
  datasetType: DatasetType;
  accessLevel: AccessLevel;
  owner: string;
  name: string;
  description: string;
  tags: string[];
};

export type HuggingFaceImportErrorType =
  | "token_invalid"
  | "access_not_granted"
  | "gated_access_required"
  | "dataset_not_found"
  | "config_not_found"
  | "split_not_found"
  | "trust_remote_code_required";

export type PreviewRow = {
  id: string;
  instruction: string;
  input: string;
  expected_output: string;
  category: string;
  source: string;
  created_at: string;
  hasIssue?: boolean;
};

export const RAG_DOCUMENT_STATUSES = ["Pending", "Processing", "Indexed", "Failed"] as const;
export const RAG_INDEX_STATUSES = ["Not Indexed", "Indexing", "Ready", "Stale", "Failed"] as const;
export const RAG_DOCUMENT_TYPES = ["PDF", "Markdown", "Text", "DOCX", "HTML"] as const;
export const RAG_VECTOR_STORES = ["Chroma", "FAISS", "Qdrant", "In-Memory"] as const;

export type RagDocumentStatus = (typeof RAG_DOCUMENT_STATUSES)[number];
export type RagIndexStatus = (typeof RAG_INDEX_STATUSES)[number];
export type RagDocumentType = (typeof RAG_DOCUMENT_TYPES)[number];
export type RagVectorStore = (typeof RAG_VECTOR_STORES)[number];

export type RagDocument = {
  id: string;
  name: string;
  type: RagDocumentType;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: string;
  status: RagDocumentStatus;
  chunkCount: number;
  folder: string;
};

export type RagChunk = {
  id: string;
  documentId: string;
  documentName: string;
  content: string;
  tokenCount: number;
  chunkIndex: number;
};

export type RagIndexConfig = {
  embeddingModelId: string;
  embeddingModelName: string;
  chunkSize: number;
  chunkOverlap: number;
  vectorStore: RagVectorStore;
  folder: string;
};

export type RagKnowledgeBase = {
  indexStatus: RagIndexStatus;
  indexConfig: RagIndexConfig;
  documents: RagDocument[];
  chunks: RagChunk[];
  totalChunks: number;
  lastIndexedAt: string | null;
  qaPairCount: number;
};

export type RagQueryResult = {
  chunk: RagChunk;
  score: number;
};

export type RagEvalMetric = {
  id: string;
  name: string;
  baseline: number;
  fineTuned: number;
  unit: string;
  description: string;
};

export type RagEvalRun = {
  id: string;
  name: string;
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  embeddingModel: string;
  status: "Completed" | "Running" | "Failed";
  completedAt: string;
  metrics: RagEvalMetric[];
  taskId?: string;
};

export type Dataset = {
  id: string;
  name: string;
  description: string;
  datasetType: DatasetType;
  source: DatasetSource;
  currentVersion: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  validationStatus: ValidationStatus;
  usageCount: number;
  lastUpdated: string;
  owner: string;
  tags: string[];
  accessLevel: AccessLevel;
  notes: string;
  format: string;
  createdAt: string;
  schemaMapping: SchemaMappingRow[];
  validationSummary: ValidationSummary;
  issues: ValidationIssue[];
  versions: DatasetVersion[];
  split: DatasetSplit;
  usage: DatasetUsageItem[];
  activityLog: DatasetActivity[];
  readiness: DatasetReadiness;
  huggingFaceSource: HuggingFaceDatasetSource | null;
  rag?: RagKnowledgeBase | null;
};

export type DatasetFilters = {
  search: string;
  datasetType: DatasetType | "all";
  source: DatasetSource | "all";
  validationStatus: ValidationStatus | "all";
  sort: "updated" | "newest" | "oldest" | "name" | "usage";
};

export type CreateDatasetWizardState = {
  step: number;
  source: DatasetSource | null;
  name: string;
  description: string;
  datasetType: DatasetType;
  owner: string;
  tags: string[];
  accessLevel: AccessLevel;
  notes: string;
  schemaMapping: SchemaMappingRow[];
  validationSummary: ValidationSummary;
  issues: ValidationIssue[];
};

export type CreateDatasetInput = {
  name: string;
  description: string;
  datasetType: DatasetType;
  source: DatasetSource;
  owner: string;
  tags: string[];
  accessLevel: AccessLevel;
  notes: string;
  schemaMapping: SchemaMappingRow[];
  validationSummary: ValidationSummary;
  issues: ValidationIssue[];
  saveAsDraft?: boolean;
  huggingFaceSource?: HuggingFaceDatasetSource | null;
  format?: string;
};
