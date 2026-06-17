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

import { USE_REAL_API } from "@/lib/api/config";
import {
  fetchDatasets,
  seedDatasets,
} from "@/modules/datasets/services/datasets-service";
import {
  DEFAULT_SCHEMA_MAPPING,
  DEFAULT_VALIDATION_ISSUES,
} from "@/modules/datasets/data/preview-rows";
import { saveDatasetsToStorage } from "@/modules/datasets/lib/storage";
import {
  buildReadiness,
  buildValidationSummary,
  computeQualityScore,
  datasetFromCreateInput,
  deriveValidationStatus,
  generateActivityId,
  generateVersionId,
  updateDataset,
} from "@/modules/datasets/lib/utils";
import { useHuggingFaceDatasetImport } from "@/modules/datasets/hooks/use-huggingface-dataset-import";
import { useRagKnowledgeBases } from "@/modules/datasets/hooks/use-rag-knowledge-bases";
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

const defaultFilters: DatasetFilters = {
  search: "",
  datasetType: "all",
  source: "all",
  validationStatus: "all",
  sort: "updated",
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

export function DatasetsProvider({ children }: { children: ReactNode }) {
  const [datasets, setDatasets] = useState<Dataset[]>(seedDatasets);
  const [filters, setFilters] = useState<DatasetFilters>(defaultFilters);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);
  const [isCreateWizardOpen, setIsCreateWizardOpen] = useState(false);

  // The HuggingFace import wizard and the RAG knowledge-base subsystem are
  // separate concerns kept in their own hooks; both operate on the shared
  // `datasets` state so the public context shape is unchanged.
  const hf = useHuggingFaceDatasetImport(setDatasets);
  const rag = useRagKnowledgeBases(datasets, setDatasets);

  // Load real data only when the API flag is on. Mock mode uses the sync seed
  // above, so there's no empty flash. (async setState in the callback is fine.)
  useEffect(() => {
    if (!USE_REAL_API) return;
    fetchDatasets().then(setDatasets).catch(() => {});
  }, []);

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

  const resetFilters = useCallback(() => setFilters(defaultFilters), []);

  const createDataset = useCallback((input: CreateDatasetInput) => {
    const dataset = datasetFromCreateInput(input);
    setDatasets((prev) => [dataset, ...prev]);
    setIsCreateWizardOpen(false);
    return dataset.id;
  }, []);

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
            dataQualityScore: computeQualityScore(d.validRows, d.totalRows),
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

  const value = useMemo<DatasetsContextValue>(
    () => ({
      datasets,
      filters,
      setFilters,
      resetFilters,
      filteredDatasets,
      selectedDatasetId,
      setSelectedDatasetId,
      selectedDataset,
      isCreateWizardOpen,
      setIsCreateWizardOpen,
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
      ...hf,
      ...rag,
    }),
    [
      datasets,
      filters,
      resetFilters,
      filteredDatasets,
      selectedDatasetId,
      selectedDataset,
      isCreateWizardOpen,
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
      hf,
      rag,
    ]
  );

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
