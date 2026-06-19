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

import { useResourceFetch } from "@/lib/use-resource-fetch";
import { computeSummaryStats, filterModels, generateId } from "@/modules/model-registry/lib/utils";
import {
  fetchModels,
  seedModels,
} from "@/modules/model-registry/services/model-registry-service";
import { useHuggingFaceModelImport } from "@/modules/model-registry/hooks/use-huggingface-model-import";
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
  modelsLoading: boolean;
  modelsError: boolean;
  reloadModels: () => void;
};

const ModelRegistryContext = createContext<ModelRegistryContextValue | null>(null);

export function ModelRegistryProvider({ children }: { children: ReactNode }) {
  const [models, setModels] = useState<RegistryModel[]>(seedModels);
  const { isLoading: modelsLoading, isError: modelsError, reload: reloadModels } = useResourceFetch(
    setModels,
    fetchModels,
    { always: true }
  );
  const [filters, setFilters] = useState<ModelFilters>(defaultFilters);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [isRegisterLocalOpen, setIsRegisterLocalOpen] = useState(false);
  const [archiveTargetId, setArchiveTargetId] = useState<string | null>(null);

  const showToast = useCallback((message: Omit<ToastMessage, "id">) => {
    const options = message.description ? { description: message.description } : undefined;
    if (message.variant === "success") toast.success(message.title, options);
    else if (message.variant === "error") toast.error(message.title, options);
    else if (message.variant === "warning") toast.warning(message.title, options);
    else toast.info(message.title, options);
  }, []);

  // The HuggingFace import wizard is a separate concern kept in its own hook;
  // it adds imported models via `setModels` and surfaces a toast on success.
  const hf = useHuggingFaceModelImport({ setModels, showToast });

  const filteredModels = useMemo(() => filterModels(models, filters), [models, filters]);
  const summaryStats = useMemo(() => computeSummaryStats(models), [models]);
  const selectedModel = useMemo(
    () => (selectedModelId ? models.find((m) => m.id === selectedModelId) ?? null : null),
    [models, selectedModelId]
  );

  const resetFilters = useCallback(() => setFilters(defaultFilters), []);

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

  const value = useMemo<ModelRegistryContextValue>(
    () => ({
      models,
      filters,
      setFilters,
      resetFilters,
      filteredModels,
      summaryStats,
      selectedModelId,
      setSelectedModelId,
      selectedModel,
      isRegisterLocalOpen,
      setIsRegisterLocalOpen,
      archiveTargetId,
      setArchiveTargetId,
      archiveModel,
      deployModel,
      stopDeployment,
      runEvaluation,
      registerLocalModel,
      showToast,
      modelsLoading,
      modelsError,
      reloadModels,
      ...hf,
    }),
    [
      models,
      filters,
      resetFilters,
      filteredModels,
      summaryStats,
      selectedModelId,
      selectedModel,
      isRegisterLocalOpen,
      archiveTargetId,
      archiveModel,
      deployModel,
      stopDeployment,
      runEvaluation,
      registerLocalModel,
      showToast,
      modelsLoading,
      modelsError,
      reloadModels,
      hf,
    ]
  );

  return (
    <ModelRegistryContext.Provider value={value}>{children}</ModelRegistryContext.Provider>
  );
}

export function useModelRegistryContext() {
  const ctx = useContext(ModelRegistryContext);
  if (!ctx) throw new Error("useModelRegistryContext must be used within ModelRegistryProvider");
  return ctx;
}
