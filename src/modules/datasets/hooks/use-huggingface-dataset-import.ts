"use client";

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import {
  HUGGINGFACE_DATASETS_CATALOG,
  MOCK_HF_EXPIRED_TOKEN,
  MOCK_HF_INVALID_TOKENS,
  MOCK_HF_VALID_TOKEN,
} from "@/modules/datasets/data/mock-huggingface-datasets-catalog";
import { catalogEntryToCreateInput, datasetFromCreateInput } from "@/modules/datasets/lib/utils";
import type {
  Dataset,
  HuggingFaceDatasetCatalogEntry,
  HuggingFaceImportConfig,
  HuggingFaceImportErrorType,
  HuggingFaceTokenStatus,
} from "@/modules/datasets/types";

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

/**
 * The Hugging Face dataset-import wizard slice: token validation, catalog
 * search, the multi-step import flow and all of its transient UI state.
 * Extracted from `DatasetsProvider` so the wizard's churny state no longer lives
 * next to durable dataset data. On success it appends the new dataset via the
 * provided `setDatasets`.
 *
 * NOTE: TL downloads datasets via `/data/download`; the search/validation here
 * is mock.
 */
export function useHuggingFaceDatasetImport(setDatasets: Dispatch<SetStateAction<Dataset[]>>) {
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
  }, [selectedHfCatalogEntry, hfImportConfig, hfTokenStatus, setDatasets]);

  return useMemo(
    () => ({
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
    }),
    [
      isHfImportOpen,
      hfImportStep,
      hfToken,
      hfTokenStatus,
      validateHfToken,
      hfSearchQuery,
      hfSearchResults,
      searchHuggingFaceDatasets,
      selectedHfCatalogEntry,
      hfImportConfig,
      hfImportProgress,
      hfImportCurrentStep,
      hfImportError,
      isHfImporting,
      startHfImport,
      resetHfImportFlow,
    ]
  );
}
