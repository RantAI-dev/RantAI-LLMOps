"use client";

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import {
  HUGGINGFACE_CATALOG,
  MOCK_EXPIRED_TOKEN,
  MOCK_INVALID_TOKENS,
  MOCK_VALID_TOKEN,
} from "@/modules/model-registry/data/mock-huggingface-catalog";
import { generateId } from "@/modules/model-registry/lib/utils";
import type {
  HuggingFaceCatalogEntry,
  ImportConfig,
  ImportErrorType,
  RegistryModel,
  ToastMessage,
  TokenStatus,
} from "@/modules/model-registry/types";

const defaultImportConfig: ImportConfig = {
  importMode: "Metadata Only",
  targetRegistry: "Model Registry",
  targetStorage: "Local Storage",
  revision: "main",
  servingEngine: "vLLM",
  modelOwner: "AI Team",
  initialStatus: "Available",
};

/** Build a full RegistryModel from a HuggingFace catalog entry + import config. */
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

/**
 * The Hugging Face model-import wizard slice: token validation, catalog search,
 * the multi-step import flow and all of its transient UI state. Extracted from
 * `ModelRegistryProvider` so the wizard's churny state no longer lives next to
 * durable registry data. On success it appends the new model via `setModels`
 * and surfaces a toast.
 *
 * NOTE: TL imports models via `/model/*`; the search/validation here is mock.
 */
export function useHuggingFaceModelImport({
  setModels,
  showToast,
}: {
  setModels: Dispatch<SetStateAction<RegistryModel[]>>;
  showToast: (toast: Omit<ToastMessage, "id">) => void;
}) {
  const [isImportOpen, setIsImportOpen] = useState(false);
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
  }, [selectedCatalogEntry, tokenStatus, importConfig, setModels, showToast]);

  return useMemo(
    () => ({
      isImportOpen,
      setIsImportOpen,
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
    }),
    [
      isImportOpen,
      hfToken,
      tokenStatus,
      validateToken,
      searchHuggingFace,
      importStep,
      searchQuery,
      searchResults,
      selectedCatalogEntry,
      importConfig,
      importProgress,
      importCurrentStep,
      importError,
      isImporting,
      startImport,
      resetImportFlow,
    ]
  );
}
