"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  Search,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  HF_IMPORT_STEPS,
  HF_IMPORT_VALIDATION_CHECKS,
  datasetUi,
  panelClassName,
} from "@/modules/datasets/constants/dataset-ui";
import { formatNumber } from "@/modules/datasets/lib/utils";
import type {
  HuggingFaceDatasetCatalogEntry,
  HuggingFaceImportConfig,
  HuggingFaceImportErrorType,
  HuggingFaceTokenStatus,
} from "@/modules/datasets/types";
import {
  ACCESS_LEVELS,
  DATASET_TYPES,
} from "@/modules/datasets/types";
import { fieldClassName } from "@/modules/tasks/constants/task-ui";
import { cn } from "@/lib/utils";

const ERROR_MESSAGES: Record<
  HuggingFaceImportErrorType,
  { title: string; explanation: string; action: string }
> = {
  token_invalid: {
    title: "Hugging Face token invalid",
    explanation: "The access token could not be validated. Check your token and try again.",
    action: "Validate a valid token before importing gated or private datasets.",
  },
  access_not_granted: {
    title: "Access not granted",
    explanation: "You do not have access to this private dataset repository.",
    action: "Request access from the dataset owner or use a valid token.",
  },
  gated_access_required: {
    title: "Gated dataset access required",
    explanation: "This dataset requires gated access from Hugging Face.",
    action: "Accept the license on Hugging Face and validate your token.",
  },
  dataset_not_found: {
    title: "Dataset not found",
    explanation: "No dataset matched your search query on Hugging Face.",
    action: "Check the repo ID (path) and try again.",
  },
  config_not_found: {
    title: "Config not found",
    explanation: "The selected config name does not exist for this dataset.",
    action: "Choose a valid config from the available options.",
  },
  split_not_found: {
    title: "Split not found",
    explanation: "The selected split is not available for this config.",
    action: "Choose a valid split (e.g. train, validation, test).",
  },
  trust_remote_code_required: {
    title: "trust_remote_code required",
    explanation: "This dataset requires trust_remote_code=true when loading.",
    action: "Enable Trust Remote Code in import configuration.",
  },
};

type ImportHuggingFaceDatasetSheetProps = {
  open: boolean;
  onClose: () => void;
  importStep: number;
  setImportStep: (step: number) => void;
  hfToken: string;
  setHfToken: (token: string) => void;
  tokenStatus: HuggingFaceTokenStatus;
  validateToken: () => Promise<HuggingFaceTokenStatus>;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchResults: HuggingFaceDatasetCatalogEntry[];
  searchHuggingFaceDatasets: (query: string) => HuggingFaceDatasetCatalogEntry[];
  selectedCatalogEntry: HuggingFaceDatasetCatalogEntry | null;
  setSelectedCatalogEntry: (entry: HuggingFaceDatasetCatalogEntry | null) => void;
  importConfig: HuggingFaceImportConfig;
  setImportConfig: React.Dispatch<React.SetStateAction<HuggingFaceImportConfig>>;
  importProgress: number;
  importCurrentStep: string;
  importError: HuggingFaceImportErrorType | null;
  isImporting: boolean;
  startImport: () => Promise<string | null>;
  resetImportFlow: () => void;
  onImportComplete: (datasetId: string) => void;
};

export function ImportHuggingFaceDatasetSheet(props: ImportHuggingFaceDatasetSheetProps) {
  const {
    open,
    onClose,
    importStep,
    setImportStep,
    hfToken,
    setHfToken,
    tokenStatus,
    validateToken,
    searchQuery,
    setSearchQuery,
    searchResults,
    searchHuggingFaceDatasets,
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
    onImportComplete,
  } = props;

  useEffect(() => {
    if (!open) resetImportFlow();
  }, [open, resetImportFlow]);

  if (!open) return null;

  const handleClose = () => {
    if (isImporting) return;
    resetImportFlow();
    onClose();
  };

  const handleSearch = () => {
    searchHuggingFaceDatasets(searchQuery);
  };

  const handleSelectEntry = (entry: HuggingFaceDatasetCatalogEntry) => {
    const defaultConfig =
      entry.configs.find((c) => c.name === entry.defaultConfig) ?? entry.configs[0]!;
    const defaultSplit = defaultConfig.splits[0]!.name;
    setSelectedCatalogEntry(entry);
    setImportConfig((c) => ({
      ...c,
      config: defaultConfig.name,
      split: defaultSplit,
      name: entry.datasetName,
      description: entry.description,
      tags: entry.tags.slice(0, 5),
      trustRemoteCode: entry.requiresTrustRemoteCode,
    }));
    setImportStep(2);
  };

  const handleImport = async () => {
    const datasetId = await startImport();
    if (datasetId) {
      setTimeout(() => {
        onImportComplete(datasetId);
        handleClose();
      }, 1000);
    }
  };

  const activeConfig = selectedCatalogEntry?.configs.find((c) => c.name === importConfig.config);
  const availableSplits = activeConfig?.splits ?? [];

  const tokenStatusColor: Record<HuggingFaceTokenStatus, string> = {
    "Not Connected": "text-ink-faint",
    Valid: "text-success",
    Invalid: "text-danger",
    Expired: "text-warning",
  };

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className="text-primary">Import from Hugging Face</SheetTitle>
          <SheetDescription>
            Step {importStep + 1} of {HF_IMPORT_STEPS.length}: {HF_IMPORT_STEPS[importStep]}
          </SheetDescription>
        </SheetHeader>

        <div className="border-b border-border px-4 py-3">
          <div className="flex gap-1">
            {HF_IMPORT_STEPS.map((step, i) => (
              <div
                key={step}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors",
                  i <= importStep ? "bg-primary" : "bg-hairline-2"
                )}
              />
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {importStep === 0 ? (
            <div className="space-y-4">
              <p className="text-[14px] text-ink-soft">
                Connect your Hugging Face account. Token is optional for public datasets. Required
                for private or gated datasets (maps to <code className="text-[12px]">token</code> in{" "}
                <code className="text-[12px]">load_dataset</code>).
              </p>
              <label className="block space-y-1.5">
                <span className={datasetUi.label}>Hugging Face Access Token</span>
                <Input
                  type="password"
                  value={hfToken}
                  onChange={(e) => setHfToken(e.target.value)}
                  placeholder="hf_..."
                  className={fieldClassName}
                />
              </label>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => validateToken()}
                  disabled={!hfToken.trim()}
                >
                  Validate Token
                </Button>
                <span className={cn("text-[13px] font-medium", tokenStatusColor[tokenStatus])}>
                  Token status: {tokenStatus}
                </span>
              </div>
            </div>
          ) : null}

          {importStep === 1 ? (
            <div className="space-y-4">
              <label className="block space-y-1.5">
                <span className={datasetUi.label}>
                  Search dataset by repo ID (path) or keyword
                </span>
                <div className="flex gap-2">
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="databricks/databricks-dolly-15k"
                    className={fieldClassName}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  />
                  <Button type="button" onClick={handleSearch}>
                    <Search className="size-4" />
                    Search
                  </Button>
                </div>
              </label>

              {searchQuery.trim() && searchResults.length === 0 ? (
                <ErrorState
                  title="Dataset not found"
                  explanation="No dataset matched your search query on Hugging Face."
                  action="Check the repo ID (path) and try again."
                  onRetry={handleSearch}
                />
              ) : null}

              <div className="space-y-3">
                {searchResults.map((entry) => (
                  <div key={entry.repoId} className={cn(panelClassName, "p-4")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-primary">{entry.datasetName}</h3>
                        <p className="text-[12px] text-ink-soft">{entry.repoId}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-[12px] text-ink-soft">
                          <span>{entry.author}</span>
                          <span>·</span>
                          <span>{entry.taskCategories.join(", ")}</span>
                          <AccessBadge access={entry.accessType} />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-ink-soft">
                          <span>License: {entry.license}</span>
                          <span>{formatNumber(entry.downloads)} downloads</span>
                          <span>{formatNumber(entry.likes)} likes</span>
                          <span>Size: {entry.sizeCategory}</span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-[12px] text-ink-soft">
                          {entry.description}
                        </p>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => handleSelectEntry(entry)}>
                        Preview
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {importStep === 2 && selectedCatalogEntry ? (
            <div className="space-y-4">
              <PreviewSection entry={selectedCatalogEntry} />
              {selectedCatalogEntry.gated ? (
                <WarningBanner
                  icon={ShieldAlert}
                  title="Gated access required"
                  message="This dataset requires gated access from Hugging Face."
                />
              ) : null}
              {selectedCatalogEntry.requiresTrustRemoteCode ? (
                <WarningBanner
                  icon={AlertTriangle}
                  title="trust_remote_code required"
                  message="Enable trust_remote_code when loading this dataset."
                />
              ) : null}
            </div>
          ) : null}

          {importStep === 3 && selectedCatalogEntry ? (
            <div className="space-y-4">
              <p className="text-[13px] text-ink-soft">
                Configure import parameters matching Hugging Face{" "}
                <code className="text-[12px]">datasets.load_dataset()</code>.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <ConfigField label="Dataset Name">
                  <Input
                    value={importConfig.name}
                    onChange={(e) => setImportConfig((c) => ({ ...c, name: e.target.value }))}
                    className={fieldClassName}
                  />
                </ConfigField>
                <ConfigField label="Dataset Type">
                  <ConfigSelect
                    value={importConfig.datasetType}
                    onChange={(v) =>
                      setImportConfig((c) => ({ ...c, datasetType: v as HuggingFaceImportConfig["datasetType"] }))
                    }
                    options={DATASET_TYPES}
                  />
                </ConfigField>
                <ConfigField label="path (repo_id)" hint="Repository ID on Hugging Face Hub">
                  <Input value={selectedCatalogEntry.repoId} readOnly className={fieldClassName} />
                </ConfigField>
                <ConfigField label="name (config)" hint="Config/subset name">
                  <Select
                    items={selectedCatalogEntry.configs.map((c) => ({
                      value: c.name,
                      label: c.default ? `${c.name} (default)` : c.name,
                    }))}
                    value={importConfig.config}
                    onValueChange={(next) => {
                      if (next == null) return;
                      const nextConfig = selectedCatalogEntry.configs.find((c) => c.name === next);
                      setImportConfig((c) => ({
                        ...c,
                        config: next,
                        split: nextConfig?.splits[0]?.name ?? c.split,
                      }));
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedCatalogEntry.configs.map((c) => (
                        <SelectItem key={c.name} value={c.name}>
                          {c.name}
                          {c.default ? " (default)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </ConfigField>
                <ConfigField label="split" hint="Dataset split to load">
                  <Select
                    items={availableSplits.map((s) => ({
                      value: s.name,
                      label: `${s.name} (${formatNumber(s.numRows)} rows)`,
                    }))}
                    value={importConfig.split}
                    onValueChange={(next) => next != null && setImportConfig((c) => ({ ...c, split: next }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableSplits.map((s) => (
                        <SelectItem key={s.name} value={s.name}>
                          {s.name} ({formatNumber(s.numRows)} rows)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </ConfigField>
                <ConfigField label="revision" hint="Git revision (branch, tag, commit)">
                  <Input
                    value={importConfig.revision}
                    onChange={(e) => setImportConfig((c) => ({ ...c, revision: e.target.value }))}
                    placeholder="main"
                    className={fieldClassName}
                  />
                </ConfigField>
                <ConfigField label="Access Level">
                  <ConfigSelect
                    value={importConfig.accessLevel}
                    onChange={(v) =>
                      setImportConfig((c) => ({ ...c, accessLevel: v as HuggingFaceImportConfig["accessLevel"] }))
                    }
                    options={ACCESS_LEVELS}
                  />
                </ConfigField>
                <ConfigField label="Owner">
                  <Input
                    value={importConfig.owner}
                    onChange={(e) => setImportConfig((c) => ({ ...c, owner: e.target.value }))}
                    className={fieldClassName}
                  />
                </ConfigField>
                <ConfigField label="Max Rows" hint="Optional row limit for import">
                  <Input
                    type="number"
                    min={1}
                    value={importConfig.maxRows ?? ""}
                    onChange={(e) =>
                      setImportConfig((c) => ({
                        ...c,
                        maxRows: e.target.value ? Number(e.target.value) : null,
                      }))
                    }
                    placeholder="All rows"
                    className={fieldClassName}
                  />
                </ConfigField>
              </div>

              <div className="flex flex-wrap gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
                  <input
                    type="checkbox"
                    checked={importConfig.streaming}
                    onChange={(e) =>
                      setImportConfig((c) => ({ ...c, streaming: e.target.checked }))
                    }
                    className="rounded border-input text-primary"
                  />
                  streaming
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
                  <input
                    type="checkbox"
                    checked={importConfig.trustRemoteCode}
                    onChange={(e) =>
                      setImportConfig((c) => ({ ...c, trustRemoteCode: e.target.checked }))
                    }
                    className="rounded border-input text-primary"
                  />
                  trust_remote_code
                </label>
              </div>

              <ConfigField label="Description">
                <Textarea
                  value={importConfig.description}
                  onChange={(e) => setImportConfig((c) => ({ ...c, description: e.target.value }))}
                  rows={2}
                  className="min-h-[60px]"
                />
              </ConfigField>

              {activeConfig ? (
                <div className={cn(panelClassName, "p-4")}>
                  <h4 className="text-[13px] font-semibold text-ink">Schema features</h4>
                  <Table className="mt-2 text-[12px]">
                    <TableHeader>
                      <TableRow className="text-ink-soft">
                        <TableHead>Column</TableHead>
                        <TableHead>dtype</TableHead>
                        <TableHead>Example</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activeConfig.features.map((f) => (
                        <TableRow key={f.name}>
                          <TableCell className="font-medium text-ink">{f.name}</TableCell>
                          <TableCell className="text-ink-soft">{f.dtype}</TableCell>
                          <TableCell className="max-w-[200px] truncate text-ink-soft">
                            {f.example ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}

              <div className={cn(panelClassName, "p-4")}>
                <h4 className="text-[13px] font-semibold text-ink">Pre-import validation</h4>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {HF_IMPORT_VALIDATION_CHECKS.map((check) => (
                    <li key={check} className="flex items-center gap-2 text-[13px] text-ink-soft">
                      <CheckCircle2 className="size-4 text-success-solid" />
                      {check}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {importStep === 4 ? (
            <div className="space-y-4">
              {importError ? (
                <ErrorState
                  title={ERROR_MESSAGES[importError].title}
                  explanation={ERROR_MESSAGES[importError].explanation}
                  action={ERROR_MESSAGES[importError].action}
                  onRetry={() => setImportStep(3)}
                />
              ) : (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="font-medium text-ink">
                        {importCurrentStep || "Starting import..."}
                      </span>
                      <span className="tabular-nums text-ink-soft">{importProgress}%</span>
                    </div>
                    <Progress value={importProgress} />
                  </div>
                  {isImporting ? (
                    <div className="flex items-center gap-2 text-[13px] text-ink-soft">
                      <Loader2 className="size-4 animate-spin text-primary" />
                      Import in progress...
                    </div>
                  ) : importProgress === 100 ? (
                    <div className="flex items-center gap-2 rounded-lg bg-success-soft p-4 text-[13px] text-success">
                      <CheckCircle2 className="size-5" />
                      Import completed successfully.
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <Button
            type="button"
            variant="outline"
            disabled={importStep === 0 || isImporting}
            onClick={() => setImportStep(Math.max(0, importStep - 1))}
          >
            <ChevronLeft className="size-4" />
            Back
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={isImporting}>
              Cancel
            </Button>
            {importStep < 3 ? (
              <Button
                type="button"
                disabled={importStep === 1 && !selectedCatalogEntry && searchResults.length === 0}
                onClick={() => {
                  if (importStep === 0) setImportStep(1);
                  else if (importStep === 1 && selectedCatalogEntry) setImportStep(2);
                  else if (importStep === 2) setImportStep(3);
                  else if (importStep === 1) handleSearch();
                }}
              >
                Next
                <ChevronRight className="size-4" />
              </Button>
            ) : importStep === 3 ? (
              <Button type="button" onClick={handleImport} disabled={!selectedCatalogEntry}>
                <Download className="size-4" />
                Import Dataset
              </Button>
            ) : importError ? (
              <Button type="button" onClick={() => setImportStep(3)}>
                Retry
              </Button>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ConfigSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
}) {
  return (
    <Select value={value} onValueChange={(next) => next != null && onChange(next)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt} value={opt}>
            {opt}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PreviewSection({ entry }: { entry: HuggingFaceDatasetCatalogEntry }) {
  const defaultConfig =
    entry.configs.find((c) => c.name === entry.defaultConfig) ?? entry.configs[0]!;

  return (
    <div className={cn(panelClassName, "space-y-3 p-4")}>
      <h3 className="font-semibold text-primary">{entry.datasetName}</h3>
      <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
        <Meta label="path (repo_id)" value={entry.repoId} />
        <Meta label="Author" value={entry.author} />
        <Meta label="Task Categories" value={entry.taskCategories.join(", ")} />
        <Meta label="License" value={entry.license} />
        <Meta label="Access Type" value={entry.accessType} />
        <Meta label="Size Category" value={entry.sizeCategory} />
        <Meta label="Default Config" value={entry.defaultConfig} />
        <Meta label="Downloads" value={formatNumber(entry.downloads)} />
      </dl>
      <div>
        <p className="text-[12px] font-medium text-ink-soft">Available configs & splits</p>
        <ul className="mt-1 space-y-1 text-[12px] text-ink-soft">
          {entry.configs.map((c) => (
            <li key={c.name}>
              <strong className="text-ink">{c.name}</strong>:{" "}
              {c.splits.map((s) => `${s.name} (${formatNumber(s.numRows)})`).join(", ")}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="text-[12px] font-medium text-ink-soft">Features ({defaultConfig.name})</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {defaultConfig.features.map((f) => (
            <span
              key={f.name}
              className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary-strong"
            >
              {f.name}: {f.dtype}
            </span>
          ))}
        </div>
      </div>
      <a
        href={`https://huggingface.co/datasets/${entry.repoId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[13px] text-primary hover:underline"
      >
        View on Hugging Face
        <ExternalLink className="size-3.5" />
      </a>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium text-ink-faint uppercase">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

function ConfigField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className={datasetUi.label}>{label}</span>
      {hint ? <span className="block text-[11px] text-ink-faint">{hint}</span> : null}
      {children}
    </label>
  );
}

function AccessBadge({ access }: { access: string }) {
  const styles =
    access === "Gated"
      ? "bg-warning-soft-2 text-warning"
      : access === "Private"
        ? "bg-danger-soft text-danger"
        : "bg-success-soft text-success";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", styles)}>{access}</span>
  );
}

function WarningBanner({
  icon: Icon,
  title,
  message,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  message: string;
}) {
  return (
    <div className="flex gap-3 rounded-lg border border-warning-border bg-warning-soft-3 p-3">
      <Icon className="size-5 shrink-0 text-warning" />
      <div>
        <p className="text-[13px] font-semibold text-warning">{title}</p>
        <p className="text-[12px] text-warning-strong">{message}</p>
      </div>
    </div>
  );
}

function ErrorState({
  title,
  explanation,
  action,
  onRetry,
}: {
  title: string;
  explanation: string;
  action: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-lg border border-danger-border bg-danger-soft p-4">
      <div className="flex gap-3">
        <XCircle className="size-5 shrink-0 text-danger" />
        <div className="space-y-2">
          <p className="text-[14px] font-semibold text-danger">{title}</p>
          <p className="text-[13px] text-danger-strong-2">{explanation}</p>
          <p className="text-[12px] text-danger-strong">{action}</p>
          {onRetry ? (
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
