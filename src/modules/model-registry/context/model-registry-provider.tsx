"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import {
  HUGGINGFACE_CATALOG,
  MOCK_EXPIRED_TOKEN,
  MOCK_INVALID_TOKENS,
  MOCK_VALID_TOKEN,
} from "@/modules/model-registry/data/mock-huggingface-catalog";
import {
  computeSummaryStats,
  filterModels,
  generateId,
  initialModels,
} from "@/modules/model-registry/lib/utils";
import type {
  HuggingFaceCatalogEntry,
  ImportConfig,
  ImportErrorType,
  ModelFilters,
  RegistryModel,
  ToastMessage,
  TokenStatus,
} from "@/modules/model-registry/types";

const defaultFilters: ModelFilters = {
  search: "",
  provider: "all",
  task: "all",
  status: "all",
  access: "all",
  compatibility: "all",
};

const defaultImportConfig: ImportConfig = {
  importMode: "Metadata Only",
  targetRegistry: "Model Registry",
  targetStorage: "Local Storage",
  revision: "main",
  servingEngine: "vLLM",
  modelOwner: "AI Team",
  initialStatus: "Available",
};

type ModelRegistryContextValue = {
  models: RegistryModel[];
  filters: ModelFilters;
  setFilters: React.Dispatch<React.SetStateAction<ModelFilters>>;
  resetFilters: () => void;
  filteredModels: RegistryModel[];
  summaryStats: ReturnType<typeof computeSummaryStats>;
  selectedModelId: string | null;
  setSelectedModelId: (id: string | null) => void;
  selectedModel: RegistryModel | null;
  isImportOpen: boolean;
  setIsImportOpen: (open: boolean) => void;
  isRegisterLocalOpen: boolean;
  setIsRegisterLocalOpen: (open: boolean) => void;
  archiveTargetId: string | null;
  setArchiveTargetId: (id: string | null) => void;
  hfToken: string;
  setHfToken: (token: string) => void;
  tokenStatus: TokenStatus;
  validateToken: () => Promise<TokenStatus>;
  searchHuggingFace: (query: string) => HuggingFaceCatalogEntry[];
  importStep: number;
  setImportStep: (step: number) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchResults: HuggingFaceCatalogEntry[];
  selectedCatalogEntry: HuggingFaceCatalogEntry | null;
  setSelectedCatalogEntry: (entry: HuggingFaceCatalogEntry | null) => void;
  importConfig: ImportConfig;
  setImportConfig: React.Dispatch<React.SetStateAction<ImportConfig>>;
  importProgress: number;
  importCurrentStep: string;
  importError: ImportErrorType | null;
  isImporting: boolean;
  startImport: () => Promise<string | null>;
  resetImportFlow: () => void;
  archiveModel: (id: string) => void;
  deployModel: (id: string, environment: "Staging" | "Production") => void;
  stopDeployment: (id: string) => void;
  runEvaluation: (id: string) => void;
  registerLocalModel: (input: {
    modelName: string;
    task: RegistryModel["task"];
    format: string;
    owner: string;
  }) => string;
  showToast: (toast: Omit<ToastMessage, "id">) => void;
};

const ModelRegistryContext = createContext<ModelRegistryContextValue | null>(null);

function catalogToModel(
  entry: HuggingFaceCatalogEntry,
  config: ImportConfig,
  modelId: string
): RegistryModel {
  const now = new Date().toISOString();
  const isVllm = config.servingEngine === "vLLM" && entry.task !== "Embedding";
  const compatStatus = isVllm
    ? "vLLM Compatible"
    : entry.task === "Embedding"
      ? "Transformers Compatible"
      : config.servingEngine === "Transformers"
        ? "Transformers Compatible"
        : "Need Review";

  return {
    id: modelId,
    modelName: entry.modelName,
    provider: "Hugging Face",
    repoId: entry.repoId,
    repoUrl: `https://huggingface.co/${entry.repoId}`,
    author: entry.author,
    task: entry.task,
    libraryName: entry.library,
    modelFormat: "HF / Safetensors",
    parameterSize: entry.parameterSize,
    contextLength: entry.contextLength,
    license: entry.license,
    language: ["English"],
    tags: entry.tags,
    accessType: entry.accessType,
    importMode: config.importMode,
    revision: config.revision,
    commitSha: generateId("sha").slice(4),
    localPath: config.importMode === "Full Download" ? `/models/${modelId}` : null,
    totalModelSize: entry.totalModelSize,
    status: config.initialStatus === "Need Review" ? "Need Review" : config.initialStatus,
    owner: config.modelOwner,
    compatibilityStatus: compatStatus,
    deploymentReadiness: compatStatus === "vLLM Compatible" ? "Ready" : "Need Review",
    vllmCompatible: isVllm ? "Yes" : entry.task === "Embedding" ? "No" : "Need Review",
    transformersCompatible: "Yes",
    requiresTrustRemoteCode: entry.requiresTrustRemoteCode,
    quantization: null,
    minVramRequired: entry.parameterSize.includes("B") ? "16 GB" : "4 GB",
    recommendedGpu: entry.parameterSize.includes("B") ? "NVIDIA A10G" : "NVIDIA T4",
    gpuCountRequired: 1,
    supportsStreaming: entry.task !== "Embedding",
    supportsChatTemplate: entry.task === "Chat" || entry.task === "Text Generation",
    createdAt: now,
    updatedAt: now,
    huggingFaceSource: {
      repoId: entry.repoId,
      repoUrl: `https://huggingface.co/${entry.repoId}`,
      author: entry.author,
      branch: config.revision,
      commitSha: generateId("sha").slice(4),
      downloads: entry.downloads,
      likes: entry.likes,
      lastModified: entry.lastModified,
      baseModel: entry.baseModel,
      datasetUsed: null,
      modelCardSummary: `${entry.modelName} imported from Hugging Face.`,
      accessType: entry.accessType,
      importMode: config.importMode,
    },
    files: entry.files.map((f) => ({
      id: generateId("file"),
      modelId,
      fileName: f.name,
      fileType: f.name.endsWith(".json") ? "Config" : f.name.includes("tokenizer") ? "Tokenizer" : "Weights",
      fileSize: f.size,
      isRequired: f.required,
      downloadStatus: config.importMode === "Full Download" ? "Downloaded" : "Pending",
      storageLocation: `/models/${modelId}/${f.name}`,
      checksum: `sha256:${generateId("cs").slice(4, 12)}`,
      downloadedAt: config.importMode === "Full Download" ? now : null,
    })),
    compatibilityChecklist: {
      accessValid: entry.accessType === "Public" || entry.accessType === "Private",
      licenseReviewed: entry.license !== "Custom",
      configAvailable: true,
      tokenizerAvailable: true,
      modelFilesAvailable: config.importMode === "Full Download",
      vllmSupported: isVllm,
      hardwareChecked: true,
    },
    deployment: {
      environment: "Development",
      servingEngine: config.servingEngine,
      endpointUrl: "",
      gpuCluster: "",
      replica: 0,
      status: "Not Deployed",
      lastDeployment: null,
      rollbackVersion: null,
    },
    evaluation: {
      evaluationDataset: "—",
      accuracy: 0,
      hallucinationRate: 0,
      safetyScore: 0,
      latencyMs: 0,
      costEstimate: "—",
      lastEvaluationRun: null,
    },
    usage: {
      totalRequests: 0,
      successRate: 0,
      errorRate: 0,
      averageLatencyMs: 0,
      tokenUsage: 0,
      estimatedCost: "$0.00",
      gpuUtilization: 0,
      activeEndpoint: null,
    },
    auditLogs: [
      {
        id: generateId("audit"),
        modelId,
        action: "Model imported",
        actor: "Admin-NQR",
        timestamp: now,
        status: "Success",
        notes: "Import completed successfully.",
      },
    ],
  };
}

export function ModelRegistryProvider({ children }: { children: ReactNode }) {
  const [models, setModels] = useState<RegistryModel[]>(initialModels);
  const [filters, setFilters] = useState<ModelFilters>(defaultFilters);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isRegisterLocalOpen, setIsRegisterLocalOpen] = useState(false);
  const [archiveTargetId, setArchiveTargetId] = useState<string | null>(null);
  const [hfToken, setHfToken] = useState("");
  const [tokenStatus, setTokenStatus] = useState<TokenStatus>("Not Connected");
  const [importStep, setImportStep] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<HuggingFaceCatalogEntry[]>([]);
  const [selectedCatalogEntry, setSelectedCatalogEntry] = useState<HuggingFaceCatalogEntry | null>(null);
  const [importConfig, setImportConfig] = useState<ImportConfig>(defaultImportConfig);
  const [importProgress, setImportProgress] = useState(0);
  const [importCurrentStep, setImportCurrentStep] = useState("");
  const [importError, setImportError] = useState<ImportErrorType | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const showToast = useCallback((message: Omit<ToastMessage, "id">) => {
    const options = message.description ? { description: message.description } : undefined;
    if (message.variant === "success") toast.success(message.title, options);
    else if (message.variant === "error") toast.error(message.title, options);
    else if (message.variant === "warning") toast.warning(message.title, options);
    else toast.info(message.title, options);
  }, []);

  const filteredModels = useMemo(() => filterModels(models, filters), [models, filters]);
  const summaryStats = useMemo(() => computeSummaryStats(models), [models]);
  const selectedModel = useMemo(
    () => (selectedModelId ? models.find((m) => m.id === selectedModelId) ?? null : null),
    [models, selectedModelId]
  );

  const resetFilters = useCallback(() => setFilters(defaultFilters), []);

  const resetImportFlow = useCallback(() => {
    setImportStep(0);
    setSearchQuery("");
    setSearchResults([]);
    setSelectedCatalogEntry(null);
    setImportConfig(defaultImportConfig);
    setImportProgress(0);
    setImportCurrentStep("");
    setImportError(null);
    setIsImporting(false);
  }, []);

  const validateToken = useCallback(async (): Promise<TokenStatus> => {
    await new Promise((r) => setTimeout(r, 800));
    const trimmed = hfToken.trim();
    if (!trimmed) {
      setTokenStatus("Not Connected");
      return "Not Connected";
    }
    if (trimmed === MOCK_EXPIRED_TOKEN || trimmed.includes("expired")) {
      setTokenStatus("Expired");
      return "Expired";
    }
    if (MOCK_INVALID_TOKENS.some((t) => trimmed.toLowerCase().includes(t))) {
      setTokenStatus("Invalid");
      return "Invalid";
    }
    if (trimmed === MOCK_VALID_TOKEN || trimmed.startsWith("hf_")) {
      setTokenStatus("Valid");
      return "Valid";
    }
    setTokenStatus("Valid");
    return "Valid";
  }, [hfToken]);

  const searchHuggingFace = useCallback((query: string): HuggingFaceCatalogEntry[] => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results = HUGGINGFACE_CATALOG.filter(
      (entry) =>
        entry.repoId.toLowerCase().includes(q) ||
        entry.modelName.toLowerCase().includes(q) ||
        entry.author.toLowerCase().includes(q) ||
        entry.tags.some((t) => t.includes(q))
    );
    setSearchResults(results);
    return results;
  }, []);

  const startImport = useCallback(async (): Promise<string | null> => {
    if (!selectedCatalogEntry) return null;
    setIsImporting(true);
    setImportError(null);
    setImportStep(4);

    const steps = [
      "Checking Access",
      "Checking License",
      "Checking Files",
      "Downloading Metadata",
      "Downloading Model Files",
      "Registering Model",
      "Validating Compatibility",
      "Import Completed",
    ];

    const entry = selectedCatalogEntry;

    if (entry.gated && tokenStatus !== "Valid") {
      setImportError("gated_access_required");
      setIsImporting(false);
      return null;
    }
    if (entry.accessType === "Private" && tokenStatus !== "Valid") {
      setImportError("access_not_granted");
      setIsImporting(false);
      return null;
    }
    if (tokenStatus === "Invalid") {
      setImportError("token_invalid");
      setIsImporting(false);
      return null;
    }
    if (entry.repoId.includes("missing-config")) {
      setImportError("missing_config");
      setIsImporting(false);
      return null;
    }
    if (importConfig.targetStorage === "S3 / MinIO" && entry.totalModelSize.includes("16")) {
      setImportError("storage_insufficient");
      setIsImporting(false);
      return null;
    }
    if (importConfig.servingEngine === "vLLM" && entry.task === "Embedding") {
      setImportError("engine_not_supported");
      setIsImporting(false);
      return null;
    }

    for (let i = 0; i < steps.length; i++) {
      setImportCurrentStep(steps[i]!);
      setImportProgress(Math.round(((i + 1) / steps.length) * 100));
      await new Promise((r) => setTimeout(r, 600));
    }

    const modelId = generateId("model");
    const newModel = catalogToModel(entry, importConfig, modelId);
    setModels((prev) => [newModel, ...prev]);
    setIsImporting(false);
    showToast({
      title: "Import completed successfully.",
      description: `${entry.modelName} has been registered.`,
      variant: "success",
    });
    return modelId;
  }, [selectedCatalogEntry, tokenStatus, importConfig, showToast]);

  const archiveModel = useCallback(
    (id: string) => {
      const now = new Date().toISOString();
      setModels((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                status: "Archived" as const,
                updatedAt: now,
                auditLogs: [
                  {
                    id: generateId("audit"),
                    modelId: id,
                    action: "Archived",
                    actor: "Admin-NQR",
                    timestamp: now,
                    status: "Info" as const,
                    notes: "Model archived from registry.",
                  },
                  ...m.auditLogs,
                ],
              }
            : m
        )
      );
      setArchiveTargetId(null);
      if (selectedModelId === id) setSelectedModelId(null);
      showToast({ title: "Model archived", variant: "info" });
    },
    [selectedModelId, showToast]
  );

  const deployModel = useCallback(
    (id: string, environment: "Staging" | "Production") => {
      const now = new Date().toISOString();
      setModels((prev) =>
        prev.map((m) => {
          if (m.id !== id) return m;
          const slug = m.modelName.toLowerCase().replace(/\s+/g, "-").slice(0, 30);
          return {
            ...m,
            status: environment === "Production" ? ("Production" as const) : m.status,
            updatedAt: now,
            deployment: {
              ...m.deployment,
              environment,
              status: "Running" as const,
              endpointUrl: `https://${environment === "Production" ? "api" : "staging"}.llm-ops.internal/v1/models/${slug}`,
              gpuCluster: environment === "Production" ? "gpu-cluster-prod-01" : "gpu-cluster-staging-01",
              replica: environment === "Production" ? 3 : 2,
              lastDeployment: now,
            },
            auditLogs: [
              {
                id: generateId("audit"),
                modelId: id,
                action: `Deployed to ${environment.toLowerCase()}`,
                actor: "Admin-NQR",
                timestamp: now,
                status: "Success" as const,
                notes: `Model deployed to ${environment}.`,
              },
              ...m.auditLogs,
            ],
          };
        })
      );
      showToast({
        title: `Deployed to ${environment}`,
        description: "Deployment initiated successfully.",
        variant: "success",
      });
    },
    [showToast]
  );

  const stopDeployment = useCallback(
    (id: string) => {
      const now = new Date().toISOString();
      setModels((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                updatedAt: now,
                deployment: { ...m.deployment, status: "Stopped" as const },
                auditLogs: [
                  {
                    id: generateId("audit"),
                    modelId: id,
                    action: "Deployment stopped",
                    actor: "Admin-NQR",
                    timestamp: now,
                    status: "Warning" as const,
                    notes: "Deployment stopped by user.",
                  },
                  ...m.auditLogs,
                ],
              }
            : m
        )
      );
      showToast({ title: "Deployment stopped", variant: "warning" });
    },
    [showToast]
  );

  const runEvaluation = useCallback(
    (id: string) => {
      const now = new Date().toISOString();
      setModels((prev) =>
        prev.map((m) =>
          m.id === id
            ? {
                ...m,
                updatedAt: now,
                evaluation: {
                  ...m.evaluation,
                  accuracy: 85 + Math.random() * 10,
                  hallucinationRate: 2 + Math.random() * 5,
                  safetyScore: 90 + Math.random() * 8,
                  latencyMs: 80 + Math.floor(Math.random() * 100),
                  costEstimate: "$0.002 / 1K tokens",
                  lastEvaluationRun: now,
                },
                auditLogs: [
                  {
                    id: generateId("audit"),
                    modelId: id,
                    action: "Evaluation run completed",
                    actor: "System",
                    timestamp: now,
                    status: "Success" as const,
                    notes: "Evaluation metrics updated.",
                  },
                  ...m.auditLogs,
                ],
              }
            : m
        )
      );
      showToast({ title: "Evaluation completed", description: "Metrics have been updated.", variant: "success" });
    },
    [showToast]
  );

  const registerLocalModel = useCallback(
    (input: { modelName: string; task: RegistryModel["task"]; format: string; owner: string }) => {
      const now = new Date().toISOString();
      const modelId = generateId("model");
      const newModel: RegistryModel = {
        id: modelId,
        modelName: input.modelName,
        provider: "Local",
        repoId: null,
        repoUrl: null,
        author: "Internal ML Team",
        task: input.task,
        libraryName: "transformers",
        modelFormat: input.format,
        parameterSize: "7B",
        contextLength: 8192,
        license: "Internal",
        language: ["English"],
        tags: ["local", "custom"],
        accessType: "Private",
        importMode: null,
        revision: "main",
        commitSha: null,
        localPath: `/models/local/${modelId}`,
        totalModelSize: "420 MB",
        status: "Draft",
        owner: input.owner,
        compatibilityStatus: "Need Review",
        deploymentReadiness: "Need Review",
        vllmCompatible: "Need Review",
        transformersCompatible: "Yes",
        requiresTrustRemoteCode: false,
        quantization: null,
        minVramRequired: "12 GB",
        recommendedGpu: "NVIDIA A10G",
        gpuCountRequired: 1,
        supportsStreaming: true,
        supportsChatTemplate: true,
        createdAt: now,
        updatedAt: now,
        huggingFaceSource: null,
        files: [],
        compatibilityChecklist: {
          accessValid: true,
          licenseReviewed: true,
          configAvailable: false,
          tokenizerAvailable: false,
          modelFilesAvailable: false,
          vllmSupported: false,
          hardwareChecked: false,
        },
        deployment: {
          environment: "Development",
          servingEngine: "vLLM",
          endpointUrl: "",
          gpuCluster: "",
          replica: 0,
          status: "Not Deployed",
          lastDeployment: null,
          rollbackVersion: null,
        },
        evaluation: {
          evaluationDataset: "—",
          accuracy: 0,
          hallucinationRate: 0,
          safetyScore: 0,
          latencyMs: 0,
          costEstimate: "—",
          lastEvaluationRun: null,
        },
        usage: {
          totalRequests: 0,
          successRate: 0,
          errorRate: 0,
          averageLatencyMs: 0,
          tokenUsage: 0,
          estimatedCost: "$0.00",
          gpuUtilization: 0,
          activeEndpoint: null,
        },
        auditLogs: [
          {
            id: generateId("audit"),
            modelId,
            action: "Local model registered",
            actor: "Admin-NQR",
            timestamp: now,
            status: "Success",
            notes: "Local model registered in Model Registry.",
          },
        ],
      };
      setModels((prev) => [newModel, ...prev]);
      showToast({
        title: "Local model registered",
        description: `${input.modelName} added to registry.`,
        variant: "success",
      });
      return modelId;
    },
    [showToast]
  );

  const value: ModelRegistryContextValue = {
    models,
    filters,
    setFilters,
    resetFilters,
    filteredModels,
    summaryStats,
    selectedModelId,
    setSelectedModelId,
    selectedModel,
    isImportOpen,
    setIsImportOpen,
    isRegisterLocalOpen,
    setIsRegisterLocalOpen,
    archiveTargetId,
    setArchiveTargetId,
    hfToken,
    setHfToken,
    tokenStatus,
    validateToken,
    searchHuggingFace,
    importStep,
    setImportStep,
    searchQuery,
    setSearchQuery,
    searchResults,
    selectedCatalogEntry,
    setSelectedCatalogEntry,
    importConfig,
    setImportConfig,
    importProgress,
    importCurrentStep,
    importError,
    isImporting,
    startImport,
    resetImportFlow,
    archiveModel,
    deployModel,
    stopDeployment,
    runEvaluation,
    registerLocalModel,
    showToast,
  };

  return (
    <ModelRegistryContext.Provider value={value}>{children}</ModelRegistryContext.Provider>
  );
}

export function useModelRegistryContext() {
  const ctx = useContext(ModelRegistryContext);
  if (!ctx) throw new Error("useModelRegistryContext must be used within ModelRegistryProvider");
  return ctx;
}
