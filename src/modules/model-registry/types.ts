export const MODEL_PROVIDERS = [
  "Hugging Face",
  "Local",
  "OpenAI",
  "Anthropic",
  "Google",
  "Custom API",
] as const;

export const MODEL_TASKS = [
  "Text Generation",
  "Chat",
  "Embedding",
  "Reranker",
  "Vision-Language",
] as const;

export const MODEL_STATUSES = [
  "Draft",
  "Available",
  "Testing",
  "Production",
  "Need Review",
  "Need Access",
  "Failed",
  "Archived",
] as const;

export const ACCESS_TYPES = ["Public", "Private", "Gated"] as const;

export const COMPATIBILITY_STATUSES = [
  "vLLM Compatible",
  "Transformers Compatible",
  "Need Review",
  "Not Supported",
] as const;

export const DEPLOYMENT_READINESS = ["Ready", "Need Review", "Blocked", "Not Supported"] as const;

export const IMPORT_JOB_STATUSES = [
  "Pending",
  "Checking Access",
  "Checking Compatibility",
  "Importing",
  "Downloading",
  "Registered",
  "Completed",
  "Failed",
  "Cancelled",
] as const;

export const IMPORT_MODES = ["Metadata Only", "Full Download"] as const;
export const TARGET_REGISTRIES = ["Model Registry", "Local Model Store"] as const;
export const TARGET_STORAGES = ["Local Storage", "S3 / MinIO"] as const;
export const SERVING_ENGINES = ["vLLM", "Transformers", "Custom"] as const;
export const MODEL_OWNERS = ["AI Team", "ML Engineer", "Product Team"] as const;
export const INITIAL_STATUSES = ["Draft", "Available", "Need Review"] as const;

export const TOKEN_STATUSES = ["Not Connected", "Valid", "Invalid", "Expired"] as const;

export type ModelProvider = (typeof MODEL_PROVIDERS)[number];
export type ModelTask = (typeof MODEL_TASKS)[number];
export type ModelStatus = (typeof MODEL_STATUSES)[number];
export type AccessType = (typeof ACCESS_TYPES)[number];
export type CompatibilityStatus = (typeof COMPATIBILITY_STATUSES)[number];
export type DeploymentReadiness = (typeof DEPLOYMENT_READINESS)[number];
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];
export type ImportMode = (typeof IMPORT_MODES)[number];
export type TargetRegistry = (typeof TARGET_REGISTRIES)[number];
export type TargetStorage = (typeof TARGET_STORAGES)[number];
export type ServingEngine = (typeof SERVING_ENGINES)[number];
export type ModelOwner = (typeof MODEL_OWNERS)[number];
export type InitialStatus = (typeof INITIAL_STATUSES)[number];
export type TokenStatus = (typeof TOKEN_STATUSES)[number];

export type ModelFile = {
  id: string;
  modelId: string;
  fileName: string;
  fileType: string;
  fileSize: string;
  isRequired: boolean;
  downloadStatus: "Downloaded" | "Pending" | "Failed" | "Not Required";
  storageLocation: string;
  checksum: string;
  downloadedAt: string | null;
};

export type AuditLog = {
  id: string;
  modelId: string;
  action: string;
  actor: string;
  timestamp: string;
  status: "Success" | "Warning" | "Failed" | "Info";
  notes: string;
};

export type DeploymentInfo = {
  environment: "Development" | "Staging" | "Production";
  servingEngine: ServingEngine;
  endpointUrl: string;
  gpuCluster: string;
  replica: number;
  status: "Running" | "Stopped" | "Deploying" | "Failed" | "Not Deployed";
  lastDeployment: string | null;
  rollbackVersion: string | null;
};

export type EvaluationMetrics = {
  evaluationDataset: string;
  accuracy: number;
  hallucinationRate: number;
  safetyScore: number;
  latencyMs: number;
  costEstimate: string;
  lastEvaluationRun: string | null;
};

export type UsageMetrics = {
  totalRequests: number;
  successRate: number;
  errorRate: number;
  averageLatencyMs: number;
  tokenUsage: number;
  estimatedCost: string;
  gpuUtilization: number;
  activeEndpoint: string | null;
};

export type HuggingFaceSource = {
  repoId: string;
  repoUrl: string;
  author: string;
  branch: string;
  commitSha: string;
  downloads: number;
  likes: number;
  lastModified: string;
  baseModel: string | null;
  datasetUsed: string | null;
  modelCardSummary: string;
  accessType: AccessType;
  importMode: ImportMode;
};

export type CompatibilityChecklist = {
  accessValid: boolean;
  licenseReviewed: boolean;
  configAvailable: boolean;
  tokenizerAvailable: boolean;
  modelFilesAvailable: boolean;
  vllmSupported: boolean;
  hardwareChecked: boolean;
};

export type RegistryModel = {
  id: string;
  modelName: string;
  provider: ModelProvider;
  repoId: string | null;
  repoUrl: string | null;
  author: string;
  task: ModelTask;
  libraryName: string;
  modelFormat: string;
  parameterSize: string;
  contextLength: number;
  license: string;
  language: string[];
  tags: string[];
  accessType: AccessType;
  importMode: ImportMode | null;
  revision: string;
  commitSha: string | null;
  localPath: string | null;
  totalModelSize: string;
  status: ModelStatus;
  owner: string;
  compatibilityStatus: CompatibilityStatus;
  deploymentReadiness: DeploymentReadiness;
  vllmCompatible: "Yes" | "No" | "Need Review";
  transformersCompatible: "Yes" | "No" | "Need Review";
  requiresTrustRemoteCode: boolean;
  quantization: string | null;
  minVramRequired: string;
  recommendedGpu: string;
  gpuCountRequired: number;
  supportsStreaming: boolean;
  supportsChatTemplate: boolean;
  createdAt: string;
  updatedAt: string;
  huggingFaceSource: HuggingFaceSource | null;
  files: ModelFile[];
  compatibilityChecklist: CompatibilityChecklist;
  deployment: DeploymentInfo;
  evaluation: EvaluationMetrics;
  usage: UsageMetrics;
  auditLogs: AuditLog[];
};

export type ImportJob = {
  id: string;
  repoId: string;
  requestedBy: string;
  importMode: ImportMode;
  targetStorage: TargetStorage;
  selectedRevision: string;
  servingEngine: ServingEngine;
  status: ImportJobStatus;
  progress: number;
  currentStep: string;
  errorMessage: string | null;
  errorType: ImportErrorType | null;
  startTime: string | null;
  finishTime: string | null;
  createdModelId: string | null;
};

export type ImportErrorType =
  | "token_invalid"
  | "access_not_granted"
  | "gated_access_required"
  | "missing_config"
  | "storage_insufficient"
  | "engine_not_supported"
  | "model_not_found"
  | "compatibility_unknown";

export type HuggingFaceCatalogEntry = {
  repoId: string;
  modelName: string;
  author: string;
  task: ModelTask;
  pipeline: string;
  library: string;
  license: string;
  accessType: AccessType;
  downloads: number;
  likes: number;
  lastModified: string;
  tags: string[];
  baseModel: string | null;
  parameterSize: string;
  contextLength: number;
  totalModelSize: string;
  requiresTrustRemoteCode: boolean;
  gated: boolean;
  files: { name: string; size: string; required: boolean }[];
};

export type ModelFilters = {
  search: string;
  provider: "all" | ModelProvider;
  task: "all" | ModelTask;
  status: "all" | ModelStatus;
  access: "all" | AccessType;
  compatibility: "all" | "vLLM Compatible" | "Need Review" | "Not Supported";
};

export type ImportConfig = {
  importMode: ImportMode;
  targetRegistry: TargetRegistry;
  targetStorage: TargetStorage;
  revision: string;
  servingEngine: ServingEngine;
  modelOwner: ModelOwner;
  initialStatus: InitialStatus;
};

export type ToastMessage = {
  id: string;
  title: string;
  description?: string;
  variant: "success" | "error" | "info" | "warning";
};
