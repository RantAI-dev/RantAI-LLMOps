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
import { ModelAccessBadge } from "@/modules/model-registry/components/model-badges";
import {
  fieldClassName,
  IMPORT_STEPS,
  modelRegistryUi,
  panelClassName,
} from "@/modules/model-registry/constants/model-registry-ui";
import { formatDateTime, formatNumber } from "@/modules/model-registry/lib/utils";
import type { ImportErrorType, TokenStatus } from "@/modules/model-registry/types";
import {
  INITIAL_STATUSES,
  MODEL_OWNERS,
  SERVING_ENGINES,
  TARGET_REGISTRIES,
} from "@/modules/model-registry/types";
import { cn } from "@/lib/utils";

const ERROR_MESSAGES: Record<
  ImportErrorType,
  { title: string; explanation: string; action: string }
> = {
  token_invalid: {
    title: "Hugging Face token invalid",
    explanation: "The access token could not be validated. Check your token and try again.",
    action: "Validate a valid token before importing gated or private models.",
  },
  access_not_granted: {
    title: "Access not granted",
    explanation: "You do not have access to this private model repository.",
    action: "Request access from the model owner or use a valid token.",
  },
  gated_access_required: {
    title: "Gated model access required",
    explanation: "This model requires gated access from Hugging Face.",
    action: "Accept the license on Hugging Face and validate your token.",
  },
  missing_config: {
    title: "Model files missing",
    explanation: "Required config.json was not found in the model repository.",
    action: "Verify the repository structure or choose a different revision.",
  },
  storage_insufficient: {
    title: "Storage not enough",
    explanation: "Storage requirement exceeds available capacity.",
    action: "Free up storage or choose a different target storage location.",
  },
  engine_not_supported: {
    title: "Model not supported by selected serving engine",
    explanation: "Embedding models are not supported by vLLM serving engine.",
    action: "Select Transformers as the serving engine for this model.",
  },
  model_not_found: {
    title: "Model not found",
    explanation: "No model matched your search query on Hugging Face.",
    action: "Check the repo ID and try again.",
  },
  compatibility_unknown: {
    title: "vLLM compatibility unknown",
    explanation: "Compatibility could not be determined automatically.",
    action: "Import as metadata only and run a manual compatibility check.",
  },
};

type ImportHuggingFaceSheetProps = {
  open: boolean;
  onClose: () => void;
  importStep: number;
  setImportStep: (step: number) => void;
  hfToken: string;
  setHfToken: (token: string) => void;
  tokenStatus: TokenStatus;
  validateToken: () => Promise<TokenStatus>;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchResults: import("@/modules/model-registry/types").HuggingFaceCatalogEntry[];
  searchHuggingFace: (query: string) => import("@/modules/model-registry/types").HuggingFaceCatalogEntry[];
  selectedCatalogEntry: import("@/modules/model-registry/types").HuggingFaceCatalogEntry | null;
  setSelectedCatalogEntry: (entry: import("@/modules/model-registry/types").HuggingFaceCatalogEntry | null) => void;
  importConfig: import("@/modules/model-registry/types").ImportConfig;
  setImportConfig: React.Dispatch<React.SetStateAction<import("@/modules/model-registry/types").ImportConfig>>;
  importProgress: number;
  importCurrentStep: string;
  importError: ImportErrorType | null;
  isImporting: boolean;
  startImport: () => Promise<string | null>;
  resetImportFlow: () => void;
  onImportComplete: (modelId: string) => void;
};

export function ImportHuggingFaceSheet(props: ImportHuggingFaceSheetProps) {
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
    searchHuggingFace,
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
    const results = searchHuggingFace(searchQuery);
    if (results.length === 0 && searchQuery.trim()) {
      // stay on step 1, user can retry
    }
  };

  const handleImport = async () => {
    const modelId = await startImport();
    if (modelId) {
      setTimeout(() => {
        onImportComplete(modelId);
        handleClose();
      }, 1000);
    }
  };

  const tokenStatusColor: Record<TokenStatus, string> = {
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
            Step {importStep + 1} of {IMPORT_STEPS.length}: {IMPORT_STEPS[importStep]}
          </SheetDescription>
        </SheetHeader>

        <div className="border-b border-border px-4 py-3">
          <div className="flex gap-1">
            {IMPORT_STEPS.map((step, i) => (
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
                Connect your Hugging Face account. For public models, token is optional. For private or gated models, a valid token is required.
              </p>
              <label className="block space-y-1.5">
                <span className={modelRegistryUi.label}>Hugging Face Access Token</span>
                <Input
                  type="password"
                  value={hfToken}
                  onChange={(e) => setHfToken(e.target.value)}
                  placeholder="hf_..."
                  className={fieldClassName}
                />
              </label>
              <div className="flex items-center gap-3">
                <Button type="button" variant="outline" onClick={() => validateToken()} disabled={!hfToken.trim()}>
                  Validate Token
                </Button>
                <span className={cn("text-[13px] font-medium", tokenStatusColor[tokenStatus])}>
                  Token status: {tokenStatus}
                </span>
              </div>
              <div className={cn(panelClassName, "p-3 text-[13px] text-ink-soft")}>
                <p><strong>Demo tokens:</strong></p>
                <p className="mt-1">Valid: <code className="text-[12px]">hf_valid_token_demo</code> or any <code className="text-[12px]">hf_*</code> prefix</p>
                <p>Invalid: contains &quot;invalid&quot; or &quot;bad-token&quot;</p>
                <p>Expired: contains &quot;expired&quot;</p>
              </div>
            </div>
          ) : null}

          {importStep === 1 ? (
            <div className="space-y-4">
              <label className="block space-y-1.5">
                <span className={modelRegistryUi.label}>Search model by repo ID or keyword</span>
                <div className="flex gap-2">
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Qwen/Qwen2.5-7B-Instruct"
                    className={fieldClassName}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  />
                  <Button type="button" onClick={handleSearch}>
                    <Search className="size-4" />
                    Search Model
                  </Button>
                </div>
              </label>

              {searchQuery.trim() && searchResults.length === 0 ? (
                <ErrorState
                  title="Model not found"
                  explanation="No model matched your search query on Hugging Face."
                  action="Check the repo ID and try again."
                  onRetry={handleSearch}
                />
              ) : null}

              <div className="space-y-3">
                {searchResults.map((entry) => (
                  <div key={entry.repoId} className={cn(panelClassName, "p-4")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-primary">{entry.modelName}</h3>
                        <p className="text-[12px] text-ink-soft">{entry.repoId}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-[12px] text-ink-soft">
                          <span>{entry.author}</span>
                          <span>·</span>
                          <span>{entry.task}</span>
                          <span>·</span>
                          <span>{entry.library}</span>
                          <ModelAccessBadge access={entry.accessType} />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-ink-soft">
                          <span>License: {entry.license}</span>
                          <span>{formatNumber(entry.downloads)} downloads</span>
                          <span>{formatNumber(entry.likes)} likes</span>
                          <span>Modified: {formatDateTime(entry.lastModified)}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {entry.tags.map((tag) => (
                            <span key={tag} className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary-strong">{tag}</span>
                          ))}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedCatalogEntry(entry);
                          setImportStep(2);
                        }}
                      >
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
                  message="This model requires gated access from Hugging Face."
                />
              ) : null}
              {selectedCatalogEntry.requiresTrustRemoteCode ? (
                <WarningBanner
                  icon={AlertTriangle}
                  title="Security warning"
                  message="This model requires trust_remote_code when loading."
                />
              ) : null}
            </div>
          ) : null}

          {importStep === 3 && selectedCatalogEntry ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <ConfigField label="Target Registry">
                  <ConfigSelect
                    value={importConfig.targetRegistry}
                    onChange={(v) => setImportConfig((c) => ({ ...c, targetRegistry: v as typeof importConfig.targetRegistry }))}
                    options={TARGET_REGISTRIES}
                  />
                </ConfigField>
                <ConfigField label="Revision">
                  <Input value={importConfig.revision} onChange={(e) => setImportConfig((c) => ({ ...c, revision: e.target.value }))} placeholder="main" className={fieldClassName} />
                </ConfigField>
                <ConfigField label="Serving Engine">
                  <ConfigSelect
                    value={importConfig.servingEngine}
                    onChange={(v) => setImportConfig((c) => ({ ...c, servingEngine: v as typeof importConfig.servingEngine }))}
                    options={SERVING_ENGINES}
                  />
                </ConfigField>
                <ConfigField label="Model Owner">
                  <ConfigSelect
                    value={importConfig.modelOwner}
                    onChange={(v) => setImportConfig((c) => ({ ...c, modelOwner: v as typeof importConfig.modelOwner }))}
                    options={MODEL_OWNERS}
                  />
                </ConfigField>
                <ConfigField label="Initial Status">
                  <ConfigSelect
                    value={importConfig.initialStatus}
                    onChange={(v) => setImportConfig((c) => ({ ...c, initialStatus: v as typeof importConfig.initialStatus }))}
                    options={INITIAL_STATUSES}
                  />
                </ConfigField>
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
                  onRetry={() => {
                    setImportStep(3);
                  }}
                />
              ) : (
                <>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="font-medium text-ink">{importCurrentStep || "Starting import..."}</span>
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
            <Button type="button" variant="outline" onClick={handleClose} disabled={isImporting}>Cancel</Button>
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
                Import Model
              </Button>
            ) : importError ? (
              <Button type="button" onClick={() => setImportStep(3)}>Retry</Button>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PreviewSection({ entry }: { entry: import("@/modules/model-registry/types").HuggingFaceCatalogEntry }) {
  return (
    <div className={cn(panelClassName, "space-y-3 p-4")}>
      <h3 className="font-semibold text-primary">{entry.modelName}</h3>
      <dl className="grid gap-2 text-[13px] sm:grid-cols-2">
        <Meta label="Repo ID" value={entry.repoId} />
        <Meta label="Author" value={entry.author} />
        <Meta label="Pipeline / Task" value={`${entry.pipeline} / ${entry.task}`} />
        <Meta label="Library" value={entry.library} />
        <Meta label="License" value={entry.license} />
        <Meta label="Access Type" value={entry.accessType} />
        <Meta label="Base Model" value={entry.baseModel ?? "—"} />
        <Meta label="Parameter Size" value={entry.parameterSize} />
        <Meta label="Context Length" value={String(entry.contextLength)} />
        <Meta label="Total Model Size" value={entry.totalModelSize} />
      </dl>
      <div>
        <p className="text-[12px] font-medium text-ink-soft">Tags</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {entry.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-medium text-primary-strong">{tag}</span>
          ))}
        </div>
      </div>
      <div>
        <p className="text-[12px] font-medium text-ink-soft">Files Summary</p>
        <ul className="mt-1 space-y-1 text-[12px] text-ink">
          {entry.files.map((f) => (
            <li key={f.name} className="flex justify-between">
              <span>{f.name}{f.required ? " *" : ""}</span>
              <span className="text-ink-soft">{f.size}</span>
            </li>
          ))}
        </ul>
      </div>
      <a
        href={`https://huggingface.co/${entry.repoId}`}
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
      <dt className="text-[11px] font-medium text-ink-faint">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}

function ConfigField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className={modelRegistryUi.label}>{label}</span>
      {children}
    </label>
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
    <div className="flex gap-3 rounded-lg border border-warning-border bg-warning-soft-2 p-3">
      <Icon className="mt-0.5 size-5 shrink-0 text-warning" />
      <div>
        <p className="text-[13px] font-semibold text-warning-strong">{title}</p>
        <p className="text-[12px] text-warning-strong-2">{message}</p>
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
        <div>
          <p className="font-semibold text-danger-strong">{title}</p>
          <p className="mt-1 text-[13px] text-danger-strong-2">{explanation}</p>
          <p className="mt-2 text-[12px] text-danger-strong">Suggested action: {action}</p>
          {onRetry ? (
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
