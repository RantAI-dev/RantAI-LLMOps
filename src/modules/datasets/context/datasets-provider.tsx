"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { initialDatasets } from "@/modules/datasets/data/initial-datasets";
import {
  HUGGINGFACE_DATASETS_CATALOG,
  MOCK_HF_EXPIRED_TOKEN,
  MOCK_HF_INVALID_TOKENS,
  MOCK_HF_VALID_TOKEN,
} from "@/modules/datasets/data/mock-huggingface-datasets-catalog";
import {
  DEFAULT_SCHEMA_MAPPING,
  DEFAULT_VALIDATION_ISSUES,
} from "@/modules/datasets/data/preview-rows";
import { loadDatasetsFromStorage, saveDatasetsToStorage } from "@/modules/datasets/lib/storage";
import { mergeRagDefaults } from "@/modules/datasets/lib/rag-utils";
import {
  buildReadiness,
  buildValidationSummary,
  catalogEntryToCreateInput,
  datasetFromCreateInput,
  deriveValidationStatus,
  generateActivityId,
  generateVersionId,
} from "@/modules/datasets/lib/utils";
import type {
  CreateDatasetInput,
  Dataset,
  DatasetFilters,
  DatasetSplit,
  HuggingFaceDatasetCatalogEntry,
  HuggingFaceImportConfig,
  HuggingFaceImportErrorType,
  HuggingFaceTokenStatus,
  RagIndexConfig,
  RagQueryResult,
  SchemaMappingRow,
} from "@/modules/datasets/types";
import { inferDocumentType } from "@/modules/datasets/data/rag-mock-data";
import {
  buildIndexChunks,
  generateRagDocumentId,
  queryRagKnowledgeBase,
} from "@/modules/datasets/lib/rag-utils";

const defaultFilters: DatasetFilters = {
  search: "",
  datasetType: "all",
  source: "all",
  validationStatus: "all",
  sort: "updated",
};

const defaultHfImportConfig: HuggingFaceImportConfig = {
  config: "default",
  split: "train",
  revision: "main",
  streaming: false,
  trustRemoteCode: false,
  importMode: "Full Download",
  maxRows: null,
  datasetType: "Training Dataset",
  accessLevel: "Team",
  owner: "Erif",
  name: "",
  description: "",
  tags: [],
};

type DatasetsContextValue = {
  datasets: Dataset[];
  filters: DatasetFilters;
  setFilters: React.Dispatch<React.SetStateAction<DatasetFilters>>;
  resetFilters: () => void;
  filteredDatasets: Dataset[];
  selectedDatasetId: string | null;
  setSelectedDatasetId: (id: string | null) => void;
  selectedDataset: Dataset | null;
  isCreateWizardOpen: boolean;
  setIsCreateWizardOpen: (open: boolean) => void;
  isHfImportOpen: boolean;
  setIsHfImportOpen: (open: boolean) => void;
  hfImportStep: number;
  setHfImportStep: (step: number) => void;
  hfToken: string;
  setHfToken: (token: string) => void;
  hfTokenStatus: HuggingFaceTokenStatus;
  validateHfToken: () => Promise<HuggingFaceTokenStatus>;
  hfSearchQuery: string;
  setHfSearchQuery: (q: string) => void;
  hfSearchResults: HuggingFaceDatasetCatalogEntry[];
  searchHuggingFaceDatasets: (query: string) => HuggingFaceDatasetCatalogEntry[];
  selectedHfCatalogEntry: HuggingFaceDatasetCatalogEntry | null;
  setSelectedHfCatalogEntry: (entry: HuggingFaceDatasetCatalogEntry | null) => void;
  hfImportConfig: HuggingFaceImportConfig;
  setHfImportConfig: React.Dispatch<React.SetStateAction<HuggingFaceImportConfig>>;
  hfImportProgress: number;
  hfImportCurrentStep: string;
  hfImportError: HuggingFaceImportErrorType | null;
  isHfImporting: boolean;
  startHfImport: () => Promise<string | null>;
  resetHfImportFlow: () => void;
  getDatasetById: (id: string) => Dataset | undefined;
  createDataset: (input: CreateDatasetInput) => string;
  archiveDataset: (id: string) => void;
  validateAgain: (id: string) => void;
  createNewVersion: (id: string, changes: string) => void;
  setActiveVersion: (datasetId: string, versionId: string) => void;
  rollbackVersion: (datasetId: string, versionId: string) => void;
  saveSplit: (datasetId: string, split: DatasetSplit) => void;
  updateSchemaMapping: (datasetId: string, mapping: SchemaMappingRow[]) => void;
  appendActivity: (
    datasetId: string,
    activity: string,
    description: string,
    actor?: string
  ) => void;
  ragKnowledgeBases: Dataset[];
  uploadRagDocument: (datasetId: string, fileName: string, sizeBytes: number) => void;
  removeRagDocument: (datasetId: string, documentId: string) => void;
  updateRagIndexConfig: (datasetId: string, config: Partial<RagIndexConfig>) => void;
  reindexRagKnowledgeBase: (datasetId: string) => Promise<void>;
  queryRag: (datasetId: string, query: string) => { answer: string; results: RagQueryResult[] } | null;
};

const DatasetsContext = createContext<DatasetsContextValue | null>(null);

function updateDataset(
  datasets: Dataset[],
  id: string,
  updater: (d: Dataset) => Dataset
): Dataset[] {
  return datasets.map((d) => (d.id === id ? updater(d) : d));
}

export function DatasetsProvider({ children }: { children: ReactNode }) {
  const [datasets, setDatasets] = useState<Dataset[]>(() =>
    mergeRagDefaults(loadDatasetsFromStorage(initialDatasets))
  );
  const [filters, setFilters] = useState<DatasetFilters>(defaultFilters);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [isCreateWizardOpen, setIsCreateWizardOpen] = useState(false);
  const [isHfImportOpen, setIsHfImportOpen] = useState(false);
  const [hfImportStep, setHfImportStep] = useState(0);
  const [hfToken, setHfToken] = useState("");
  const [hfTokenStatus, setHfTokenStatus] = useState<HuggingFaceTokenStatus>("Not Connected");
  const [hfSearchQuery, setHfSearchQuery] = useState("");
  const [hfSearchResults, setHfSearchResults] = useState<HuggingFaceDatasetCatalogEntry[]>([]);
  const [selectedHfCatalogEntry, setSelectedHfCatalogEntry] =
    useState<HuggingFaceDatasetCatalogEntry | null>(null);
  const [hfImportConfig, setHfImportConfig] = useState<HuggingFaceImportConfig>(defaultHfImportConfig);
  const [hfImportProgress, setHfImportProgress] = useState(0);
  const [hfImportCurrentStep, setHfImportCurrentStep] = useState("");
  const [hfImportError, setHfImportError] = useState<HuggingFaceImportErrorType | null>(null);
  const [isHfImporting, setIsHfImporting] = useState(false);

  // Persist to localStorage on change. (Initial load is handled by the lazy
  // useState initializer above — this provider only mounts client-side.)
  useEffect(() => {
    saveDatasetsToStorage(datasets);
  }, [datasets]);

  const getDatasetById = useCallback(
    (id: string) => datasets.find((d) => d.id === id),
    [datasets]
  );

  const appendActivity = useCallback(
    (
      datasetId: string,
      activity: string,
      description: string,
      actor = "Admin-NQR"
    ) => {
      const now = new Date().toISOString();
      setDatasets((prev) =>
        updateDataset(prev, datasetId, (d) => ({
          ...d,
          lastUpdated: now,
          activityLog: [
            {
              id: generateActivityId(),
              timestamp: now,
              actor,
              activity,
              description,
            },
            ...d.activityLog,
          ],
        }))
      );
    },
    []
  );

  const filteredDatasets = useMemo(() => {
    let result = datasets.filter((d) => d.validationStatus !== "Archived");
    const q = filters.search.trim().toLowerCase();

    if (q) {
      result = result.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.description.toLowerCase().includes(q) ||
          d.owner.toLowerCase().includes(q) ||
          d.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    if (filters.datasetType !== "all") {
      result = result.filter((d) => d.datasetType === filters.datasetType);
    }
    if (filters.source !== "all") {
      result = result.filter((d) => d.source === filters.source);
    }
    if (filters.validationStatus !== "all") {
      result = result.filter((d) => d.validationStatus === filters.validationStatus);
    }

    result.sort((a, b) => {
      switch (filters.sort) {
        case "newest":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "oldest":
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case "name":
          return a.name.localeCompare(b.name);
        case "usage":
          return b.usageCount - a.usageCount;
        case "updated":
        default:
          return new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime();
      }
    });

    return result;
  }, [datasets, filters]);

  const selectedDataset = useMemo(
    () => datasets.find((d) => d.id === selectedDatasetId) ?? null,
    [datasets, selectedDatasetId]
  );

  const createDataset = useCallback((input: CreateDatasetInput) => {
    const dataset = datasetFromCreateInput(input);
    setDatasets((prev) => [dataset, ...prev]);
    setIsCreateWizardOpen(false);
    return dataset.id;
  }, []);

  const resetHfImportFlow = useCallback(() => {
    setHfImportStep(0);
    setHfSearchQuery("");
    setHfSearchResults([]);
    setSelectedHfCatalogEntry(null);
    setHfImportConfig(defaultHfImportConfig);
    setHfImportProgress(0);
    setHfImportCurrentStep("");
    setHfImportError(null);
    setIsHfImporting(false);
  }, []);

  const validateHfToken = useCallback(async (): Promise<HuggingFaceTokenStatus> => {
    await new Promise((r) => setTimeout(r, 800));
    const trimmed = hfToken.trim();
    if (!trimmed) {
      setHfTokenStatus("Not Connected");
      return "Not Connected";
    }
    if (trimmed === MOCK_HF_EXPIRED_TOKEN || trimmed.includes("expired")) {
      setHfTokenStatus("Expired");
      return "Expired";
    }
    if (MOCK_HF_INVALID_TOKENS.some((t) => trimmed.toLowerCase().includes(t))) {
      setHfTokenStatus("Invalid");
      return "Invalid";
    }
    if (trimmed === MOCK_HF_VALID_TOKEN || trimmed.startsWith("hf_")) {
      setHfTokenStatus("Valid");
      return "Valid";
    }
    setHfTokenStatus("Valid");
    return "Valid";
  }, [hfToken]);

  const searchHuggingFaceDatasets = useCallback((query: string): HuggingFaceDatasetCatalogEntry[] => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const results = HUGGINGFACE_DATASETS_CATALOG.filter(
      (entry) =>
        entry.repoId.toLowerCase().includes(q) ||
        entry.datasetName.toLowerCase().includes(q) ||
        entry.author.toLowerCase().includes(q) ||
        entry.tags.some((t) => t.includes(q)) ||
        entry.taskCategories.some((t) => t.includes(q))
    );
    setHfSearchResults(results);
    return results;
  }, []);

  const startHfImport = useCallback(async (): Promise<string | null> => {
    if (!selectedHfCatalogEntry) return null;
    setIsHfImporting(true);
    setHfImportError(null);
    setHfImportStep(4);

    const entry = selectedHfCatalogEntry;
    const config = hfImportConfig;
    const datasetConfig = entry.configs.find((c) => c.name === config.config);

    const steps = [
      "Checking Repository Access",
      "Validating Config Name",
      "Checking Split Availability",
      "Downloading Dataset Info",
      "Loading Dataset Split",
      "Mapping Schema Features",
      "Registering Dataset",
      "Import Completed",
    ];

    if (entry.gated && hfTokenStatus !== "Valid") {
      setHfImportError("gated_access_required");
      setIsHfImporting(false);
      return null;
    }
    if (entry.private && hfTokenStatus !== "Valid") {
      setHfImportError("access_not_granted");
      setIsHfImporting(false);
      return null;
    }
    if (hfTokenStatus === "Invalid") {
      setHfImportError("token_invalid");
      setIsHfImporting(false);
      return null;
    }
    if (!datasetConfig) {
      setHfImportError("config_not_found");
      setIsHfImporting(false);
      return null;
    }
    if (!datasetConfig.splits.some((s) => s.name === config.split)) {
      setHfImportError("split_not_found");
      setIsHfImporting(false);
      return null;
    }
    if (entry.requiresTrustRemoteCode && !config.trustRemoteCode) {
      setHfImportError("trust_remote_code_required");
      setIsHfImporting(false);
      return null;
    }

    for (let i = 0; i < steps.length; i++) {
      setHfImportCurrentStep(steps[i]!);
      setHfImportProgress(Math.round(((i + 1) / steps.length) * 100));
      await new Promise((r) => setTimeout(r, 600));
    }

    const input = catalogEntryToCreateInput(entry, config);
    const dataset = datasetFromCreateInput(input);
    setDatasets((prev) => [dataset, ...prev]);
    setIsHfImporting(false);
    setIsHfImportOpen(false);
    return dataset.id;
  }, [selectedHfCatalogEntry, hfImportConfig, hfTokenStatus]);

  const archiveDataset = useCallback(
    (id: string) => {
      const now = new Date().toISOString();
      setDatasets((prev) =>
        updateDataset(prev, id, (d) => ({
          ...d,
          validationStatus: "Archived",
          lastUpdated: now,
          activityLog: [
            {
              id: generateActivityId(),
              timestamp: now,
              actor: "Admin-NQR",
              activity: "Dataset archived",
              description: `${d.name} moved to archive`,
            },
            ...d.activityLog,
          ],
        }))
      );
      setSelectedDatasetId((cur) => (cur === id ? null : cur));
    },
    []
  );

  const validateAgain = useCallback((id: string) => {
    const now = new Date().toISOString();
    setDatasets((prev) =>
      updateDataset(prev, id, (d) => {
        const validating = { ...d, validationStatus: "Validating" as const, lastUpdated: now };
        return validating;
      })
    );

    window.setTimeout(() => {
      setDatasets((prev) =>
        updateDataset(prev, id, (d) => {
          const status = deriveValidationStatus(
            d.invalidRows,
            d.usageCount,
            false,
            false
          );
          const summary = buildValidationSummary(d.totalRows, d.invalidRows, {
            ...d.validationSummary,
            dataQualityScore: Math.round((d.validRows / d.totalRows) * 100),
          });
          return {
            ...d,
            validationStatus: status,
            validationSummary: summary,
            lastUpdated: new Date().toISOString(),
            readiness: buildReadiness({ ...d, validationStatus: status }),
            activityLog: [
              {
                id: generateActivityId(),
                timestamp: new Date().toISOString(),
                actor: "System",
                activity: "Validation completed",
                description: `Quality score: ${summary.dataQualityScore}%`,
              },
              ...d.activityLog,
            ],
          };
        })
      );
    }, 1500);
  }, []);

  const createNewVersion = useCallback((id: string, changes: string) => {
    const now = new Date().toISOString();
    setDatasets((prev) =>
      updateDataset(prev, id, (d) => {
        const nextNum = d.versions.length + 1;
        const versionLabel = `v${nextNum}`;
        const improvedInvalid = Math.max(0, Math.floor(d.invalidRows * 0.5));
        const validRows = d.totalRows - improvedInvalid;
        const summary = buildValidationSummary(d.totalRows, improvedInvalid);
        const status = deriveValidationStatus(improvedInvalid, d.usageCount);

        const newVersion = {
          id: generateVersionId(),
          version: versionLabel,
          changes,
          rows: validRows,
          validationStatus: status,
          qualityScore: summary.dataQualityScore,
          createdBy: d.owner,
          createdAt: now,
          isActive: true,
        };

        return {
          ...d,
          currentVersion: versionLabel,
          validRows,
          invalidRows: improvedInvalid,
          validationStatus: status,
          validationSummary: summary,
          readiness: buildReadiness({
            ...d,
            invalidRows: improvedInvalid,
            validationStatus: status,
          }),
          lastUpdated: now,
          versions: [
            newVersion,
            ...d.versions.map((v) => ({ ...v, isActive: false })),
          ],
          activityLog: [
            {
              id: generateActivityId(),
              timestamp: now,
              actor: d.owner,
              activity: "New version created",
              description: `${versionLabel}: ${changes}`,
            },
            ...d.activityLog,
          ],
        };
      })
    );
  }, []);

  const setActiveVersion = useCallback((datasetId: string, versionId: string) => {
    setDatasets((prev) =>
      updateDataset(prev, datasetId, (d) => {
        const target = d.versions.find((v) => v.id === versionId);
        if (!target) return d;
        const now = new Date().toISOString();
        return {
          ...d,
          currentVersion: target.version,
          totalRows: target.rows,
          validationStatus: target.validationStatus,
          validationSummary: {
            ...d.validationSummary,
            totalRows: target.rows,
            dataQualityScore: target.qualityScore,
          },
          lastUpdated: now,
          versions: d.versions.map((v) => ({
            ...v,
            isActive: v.id === versionId,
          })),
          activityLog: [
            {
              id: generateActivityId(),
              timestamp: now,
              actor: "Admin-NQR",
              activity: "Active version changed",
              description: `${target.version} set as active`,
            },
            ...d.activityLog,
          ],
        };
      })
    );
  }, []);

  const rollbackVersion = useCallback((datasetId: string, versionId: string) => {
    setActiveVersion(datasetId, versionId);
    appendActivity(datasetId, "Version rollback", "Rolled back to previous version");
  }, [appendActivity, setActiveVersion]);

  const saveSplit = useCallback((datasetId: string, split: DatasetSplit) => {
    const now = new Date().toISOString();
    setDatasets((prev) =>
      updateDataset(prev, datasetId, (d) => ({
        ...d,
        split,
        lastUpdated: now,
        activityLog: [
          {
            id: generateActivityId(),
            timestamp: now,
            actor: "Admin-NQR",
            activity: "Split configuration updated",
            description: `Training ${split.training}%, Validation ${split.validation}%`,
          },
          ...d.activityLog,
        ],
      }))
    );
  }, []);

  const updateSchemaMapping = useCallback(
    (datasetId: string, mapping: SchemaMappingRow[]) => {
      const now = new Date().toISOString();
      setDatasets((prev) =>
        updateDataset(prev, datasetId, (d) => ({
          ...d,
          schemaMapping: mapping,
          lastUpdated: now,
          activityLog: [
            {
              id: generateActivityId(),
              timestamp: now,
              actor: "Admin-NQR",
              activity: "Schema mapping updated",
              description: "Column mapping configuration saved",
            },
            ...d.activityLog,
          ],
        }))
      );
    },
    []
  );

  const ragKnowledgeBases = useMemo(
    () =>
      datasets.filter(
        (d) => d.datasetType === "RAG Knowledge Base" && d.validationStatus !== "Archived"
      ),
    [datasets]
  );

  const uploadRagDocument = useCallback(
    (datasetId: string, fileName: string, sizeBytes: number) => {
      const now = new Date().toISOString();
      const doc = {
        id: generateRagDocumentId(),
        name: fileName,
        type: inferDocumentType(fileName),
        sizeBytes,
        uploadedAt: now,
        uploadedBy: "Admin-NQR",
        status: "Pending" as const,
        chunkCount: 0,
        folder: "rag",
      };

      setDatasets((prev) =>
        updateDataset(prev, datasetId, (d) => {
          if (!d.rag) return d;
          return {
            ...d,
            lastUpdated: now,
            rag: {
              ...d.rag,
              indexStatus: "Stale",
              documents: [doc, ...d.rag.documents],
            },
            activityLog: [
              {
                id: generateActivityId(),
                timestamp: now,
                actor: "Admin-NQR",
                activity: "Document uploaded",
                description: `${fileName} added to knowledge base`,
              },
              ...d.activityLog,
            ],
          };
        })
      );
    },
    []
  );

  const removeRagDocument = useCallback((datasetId: string, documentId: string) => {
    const now = new Date().toISOString();
    setDatasets((prev) =>
      updateDataset(prev, datasetId, (d) => {
        if (!d.rag) return d;
        const removed = d.rag.documents.find((doc) => doc.id === documentId);
        return {
          ...d,
          lastUpdated: now,
          rag: {
            ...d.rag,
            indexStatus: "Stale",
            documents: d.rag.documents.filter((doc) => doc.id !== documentId),
            chunks: d.rag.chunks.filter((c) => c.documentId !== documentId),
          },
          activityLog: [
            {
              id: generateActivityId(),
              timestamp: now,
              actor: "Admin-NQR",
              activity: "Document removed",
              description: removed ? `${removed.name} removed from knowledge base` : "Document removed",
            },
            ...d.activityLog,
          ],
        };
      })
    );
  }, []);

  const updateRagIndexConfig = useCallback(
    (datasetId: string, config: Partial<RagIndexConfig>) => {
      const now = new Date().toISOString();
      setDatasets((prev) =>
        updateDataset(prev, datasetId, (d) => {
          if (!d.rag) return d;
          return {
            ...d,
            lastUpdated: now,
            rag: {
              ...d.rag,
              indexStatus: d.rag.indexStatus === "Ready" ? "Stale" : d.rag.indexStatus,
              indexConfig: { ...d.rag.indexConfig, ...config },
            },
            activityLog: [
              {
                id: generateActivityId(),
                timestamp: now,
                actor: "Admin-NQR",
                activity: "Search settings updated",
                description: "Indexing configuration saved",
              },
              ...d.activityLog,
            ],
          };
        })
      );
    },
    []
  );

  const reindexRagKnowledgeBase = useCallback(async (datasetId: string) => {
    setDatasets((prev) =>
      updateDataset(prev, datasetId, (d) =>
        d.rag ? { ...d, rag: { ...d.rag, indexStatus: "Indexing" } } : d
      )
    );

    await new Promise((r) => setTimeout(r, 2000));

    setDatasets((prev) =>
      updateDataset(prev, datasetId, (d) => {
        if (!d.rag) return d;
        const indexedDocs = d.rag.documents.map((doc) => ({
          ...doc,
          status: "Indexed" as const,
          chunkCount: Math.max(1, Math.ceil(doc.sizeBytes / (d.rag!.indexConfig.chunkSize * 4))),
        }));
        const { chunks, totalChunks } = buildIndexChunks(indexedDocs, d.rag.indexConfig);
        const finished = new Date().toISOString();
        return {
          ...d,
          lastUpdated: finished,
          readiness: buildReadiness(d),
          rag: {
            ...d.rag,
            indexStatus: "Ready",
            documents: indexedDocs,
            chunks,
            totalChunks,
            lastIndexedAt: finished,
          },
          activityLog: [
            {
              id: generateActivityId(),
              timestamp: finished,
              actor: "System",
              activity: "Index rebuilt",
              description: `${totalChunks} passages indexed and ready for search`,
            },
            ...d.activityLog,
          ],
        };
      })
    );
  }, []);

  const queryRag = useCallback(
    (datasetId: string, query: string) => {
      const dataset = datasets.find((d) => d.id === datasetId);
      if (!dataset?.rag || dataset.rag.indexStatus !== "Ready") return null;
      return queryRagKnowledgeBase(dataset.rag, query);
    },
    [datasets]
  );

  const value: DatasetsContextValue = {
    datasets,
    filters,
    setFilters,
    resetFilters: () => setFilters(defaultFilters),
    filteredDatasets,
    selectedDatasetId,
    setSelectedDatasetId,
    selectedDataset,
    isCreateWizardOpen,
    setIsCreateWizardOpen,
    isHfImportOpen,
    setIsHfImportOpen,
    hfImportStep,
    setHfImportStep,
    hfToken,
    setHfToken,
    hfTokenStatus,
    validateHfToken,
    hfSearchQuery,
    setHfSearchQuery,
    hfSearchResults,
    searchHuggingFaceDatasets,
    selectedHfCatalogEntry,
    setSelectedHfCatalogEntry,
    hfImportConfig,
    setHfImportConfig,
    hfImportProgress,
    hfImportCurrentStep,
    hfImportError,
    isHfImporting,
    startHfImport,
    resetHfImportFlow,
    getDatasetById,
    createDataset,
    archiveDataset,
    validateAgain,
    createNewVersion,
    setActiveVersion,
    rollbackVersion,
    saveSplit,
    updateSchemaMapping,
    appendActivity,
    ragKnowledgeBases,
    uploadRagDocument,
    removeRagDocument,
    updateRagIndexConfig,
    reindexRagKnowledgeBase,
    queryRag,
  };

  return (
    <DatasetsContext.Provider value={value}>{children}</DatasetsContext.Provider>
  );
}

export function useDatasets() {
  const ctx = useContext(DatasetsContext);
  if (!ctx) {
    throw new Error("useDatasets must be used within DatasetsProvider");
  }
  return ctx;
}

export function getDefaultWizardValidation() {
  return {
    summary: buildValidationSummary(12000, 260),
    issues: DEFAULT_VALIDATION_ISSUES,
    mapping: DEFAULT_SCHEMA_MAPPING,
  };
}
