"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Cloud,
  Database,
  Download,
  FileUp,
  Globe,
  PenLine,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { MockBadge } from "@/components/ui/mock-badge";
import { MockBanner } from "@/components/ui/mock-banner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { DatasetFormField } from "@/modules/datasets/components/dataset-form-field";
import { DatasetWizardStepper } from "@/modules/datasets/components/dataset-wizard-stepper";
import {
  WIZARD_STEPS,
  panelClassName,
  searchFieldClassName,
} from "@/modules/datasets/constants/dataset-ui";
import { getDefaultWizardValidation } from "@/modules/datasets/context/datasets-provider";
import {
  DEFAULT_SCHEMA_MAPPING,
  INVOICE_PREVIEW_ROWS,
} from "@/modules/datasets/data/preview-rows";
import { formatNumber, sourceLabel } from "@/modules/datasets/lib/utils";
import type {
  AccessLevel,
  CreateDatasetInput,
  DatasetSource,
  DatasetType,
  SchemaMappingRow,
  StandardField,
} from "@/modules/datasets/types";
import {
  ACCESS_LEVELS,
  DATASET_TYPES,
  STANDARD_FIELDS,
} from "@/modules/datasets/types";
import { cn } from "@/lib/utils";

type CreateDatasetWizardProps = {
  open: boolean;
  onClose: () => void;
  onSave: (input: CreateDatasetInput) => string;
  onSaveAndUseExperiment?: (datasetId: string) => void;
  onOpenHuggingFaceImport?: () => void;
  preset?: {
    datasetType?: DatasetType;
    source?: DatasetSource;
    name?: string;
    description?: string;
  };
};

const SOURCE_OPTIONS: {
  source: DatasetSource;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
}[] = [
  {
    source: "File Upload",
    title: "Upload File",
    description: "CSV, JSONL, Excel, TXT, PDF",
    icon: FileUp,
  },
  {
    source: "Hugging Face",
    title: "Hugging Face",
    description: "Import from Hugging Face Hub (load_dataset)",
    icon: Download,
  },
  {
    source: "Database",
    title: "Connect Database",
    description: "PostgreSQL, MySQL, MongoDB",
    icon: Database,
    disabled: true,
  },
  {
    source: "Cloud Storage",
    title: "Connect Storage",
    description: "S3, GCS, Azure Blob",
    icon: Cloud,
  },
  {
    source: "API",
    title: "API",
    description: "Import from internal or external API",
    icon: Globe,
  },
  {
    source: "Manual Input",
    title: "Manual Input",
    description: "Create sample Q&A manually",
    icon: PenLine,
  },
];

export function CreateDatasetWizard({
  open,
  onClose,
  onSave,
  onSaveAndUseExperiment,
  onOpenHuggingFaceImport,
  preset,
}: CreateDatasetWizardProps) {
  const defaults = getDefaultWizardValidation();
  const [step, setStep] = useState(0);
  const [source, setSource] = useState<DatasetSource | null>(preset?.source ?? "File Upload");
  const [name, setName] = useState(preset?.name ?? "Invoice Validation Dataset");
  const [description, setDescription] = useState(
    preset?.description ?? "Fine-tuning examples for warehouse invoice validation."
  );
  const [datasetType, setDatasetType] = useState<DatasetType>(
    preset?.datasetType ?? "Training Dataset"
  );
  const [owner, setOwner] = useState("Erif");
  const [tags, setTags] = useState("invoice, validation, wms");
  const [accessLevel, setAccessLevel] = useState<AccessLevel>("Team");
  const [notes, setNotes] = useState("");
  const [mapping, setMapping] = useState<SchemaMappingRow[]>(defaults.mapping);
  const [previewSearch, setPreviewSearch] = useState("");
  const [previewPage, setPreviewPage] = useState(0);
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>({
    instruction: true,
    input: true,
    expected_output: true,
    category: true,
    source: true,
    created_at: true,
  });

  const validation = useMemo(
    () => ({
      summary: defaults.summary,
      issues: defaults.issues,
    }),
    [defaults]
  );

  const missingRequired =
    !mapping.some((m) => m.standardField === "instruction") ||
    !mapping.some((m) => m.standardField === "expected_output");

  const filteredPreview = useMemo(() => {
    const q = previewSearch.trim().toLowerCase();
    if (!q) return INVOICE_PREVIEW_ROWS;
    return INVOICE_PREVIEW_ROWS.filter((r) =>
      Object.values(r).some((v) => String(v).toLowerCase().includes(q))
    );
  }, [previewSearch]);

  const pageSize = 5;

  // State above is initialized from `preset`/defaults at mount — the parent
  // remounts this wizard via `key`, so no reset effect is needed.
  const previewSlice = filteredPreview.slice(
    previewPage * pageSize,
    previewPage * pageSize + pageSize
  );
  const previewPages = Math.max(1, Math.ceil(filteredPreview.length / pageSize));

  if (!open) return null;

  function handleAutoMap() {
    setMapping(DEFAULT_SCHEMA_MAPPING.map((m) => ({ ...m })));
  }

  function handleResetMapping() {
    setMapping(
      DEFAULT_SCHEMA_MAPPING.map((m) => ({
        ...m,
        standardField: "" as StandardField | "",
        mappingStatus: "Missing" as const,
      }))
    );
  }

  function buildInput(saveAsDraft?: boolean): CreateDatasetInput {
    return {
      name: name.trim() || "Untitled Dataset",
      description,
      datasetType,
      source: source ?? "File Upload",
      owner,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      accessLevel,
      notes,
      schemaMapping: mapping,
      validationSummary: validation.summary,
      issues: validation.issues,
      saveAsDraft,
    };
  }

  function resetAndClose() {
    setStep(0);
    onClose();
  }

  function handleSaveDraft() {
    onSave({ ...buildInput(true) });
    resetAndClose();
  }

  function handleSave() {
    onSave(buildInput(false));
    resetAndClose();
  }

  function handleSaveAndUse() {
    const id = onSave(buildInput(false));
    onSaveAndUseExperiment?.(id);
    resetAndClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) resetAndClose();
      }}
    >
      <DialogContent className="flex h-[min(92vh,880px)] w-full max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="border-b border-hairline px-5 py-4 text-left">
          <DialogTitle className="text-primary">Create Dataset</DialogTitle>
          <DialogDescription>
            Upload, connect, and validate a dataset for your LLM workflows.
          </DialogDescription>
        </DialogHeader>

          <DatasetWizardStepper steps={WIZARD_STEPS} currentStep={step} />

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {step === 0 ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {SOURCE_OPTIONS.map((opt) => (
                    <button
                      key={opt.source}
                      type="button"
                      disabled={opt.disabled}
                      onClick={() => !opt.disabled && setSource(opt.source)}
                      className={cn(
                        "rounded-lg border p-4 text-left transition-colors",
                        opt.disabled && "cursor-not-allowed opacity-50",
                        source === opt.source
                          ? "border-primary bg-primary-soft/40 shadow-[0_0_0_1px_rgba(255,80,1,0.2)]"
                          : "border-hairline bg-white hover:border-primary/25 hover:bg-primary-tint-2"
                      )}
                    >
                      <opt.icon className="mb-2 size-5 text-primary" />
                      <p className="text-[14px] font-semibold text-ink">{opt.title}</p>
                      <p className="mt-1 text-[12px] leading-4 text-ink-soft">{opt.description}</p>
                      {opt.disabled ? (
                        <span className="mt-2 inline-block rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-ink-faint-strong">
                          Coming soon
                        </span>
                      ) : opt.source === "API" || opt.source === "Cloud Storage" ? (
                        <span className="mt-2 inline-flex">
                          <MockBadge label="No backend" />
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
                {source === "Hugging Face" ? (
                  <div className="rounded-lg border border-warning-border bg-warning-soft-3 px-4 py-3 text-[13px] text-warning-strong">
                    Hugging Face import uses dedicated flow with{" "}
                    <code className="text-[12px]">path</code>, <code className="text-[12px]">name</code>
                    , <code className="text-[12px]">split</code>, and{" "}
                    <code className="text-[12px]">revision</code> parameters. Click Next to open
                    the import wizard.
                  </div>
                ) : null}
              </div>
            ) : null}

            {step === 1 ? (
              <div className="mx-auto max-w-xl space-y-4">
                <DatasetFormField label="Dataset Name" required helper="Unique name for this AI asset.">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Invoice Validation Dataset"
                  />
                </DatasetFormField>
                <DatasetFormField label="Description" helper="What this dataset contains and how it will be used.">
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    className="min-h-[72px]"
                    placeholder="Brief description..."
                  />
                </DatasetFormField>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <DatasetFormField label="Dataset Type" helper="Recommended workflows depend on type.">
                    <WizardSelect
                      value={datasetType}
                      onChange={(v) => setDatasetType(v as DatasetType)}
                      options={DATASET_TYPES}
                    />
                  </DatasetFormField>
                  <DatasetFormField label="Access Level" helper="Who can view and use this dataset.">
                    <WizardSelect
                      value={accessLevel}
                      onChange={(v) => setAccessLevel(v as AccessLevel)}
                      options={ACCESS_LEVELS}
                    />
                  </DatasetFormField>
                </div>
                <DatasetFormField label="Owner" helper="Accountable for quality and access.">
                  <Input value={owner} onChange={(e) => setOwner(e.target.value)} />
                </DatasetFormField>
                <DatasetFormField label="Tags" helper="Comma-separated for search and organization.">
                  <Input
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    placeholder="invoice, wms"
                  />
                </DatasetFormField>
                <DatasetFormField label="Notes" helper="Optional internal notes.">
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                  />
                </DatasetFormField>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-4">
                <div className={cn(panelClassName, "grid grid-cols-2 gap-3 p-3 sm:grid-cols-5")}>
                  <SummaryPill label="Total rows" value={formatNumber(12000)} />
                  <SummaryPill label="Columns" value="6" />
                  <SummaryPill label="Format" value="JSONL" />
                  <SummaryPill label="Preview" value="Sample" />
                  <SummaryPill label="Warnings" value="4 empty cells" warn />
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative w-full max-w-sm">
                    <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-primary/70" />
                    <Input
                      value={previewSearch}
                      onChange={(e) => {
                        setPreviewSearch(e.target.value);
                        setPreviewPage(0);
                      }}
                      placeholder="Search rows..."
                      className={searchFieldClassName}
                    />
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {Object.keys(visibleCols).map((col) => (
                      <label
                        key={col}
                        className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink"
                      >
                        <input
                          type="checkbox"
                          checked={visibleCols[col]}
                          onChange={() => setVisibleCols((v) => ({ ...v, [col]: !v[col] }))}
                          className="rounded border-input text-primary"
                        />
                        {col}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="overflow-hidden rounded-lg border border-hairline bg-white">
                  <Table className="min-w-[640px] text-[13px]">
                    <TableHeader>
                      <TableRow className="bg-surface">
                        {visibleCols.instruction ? <TableHead>instruction</TableHead> : null}
                        {visibleCols.input ? <TableHead>input</TableHead> : null}
                        {visibleCols.expected_output ? (
                          <TableHead>expected_output</TableHead>
                        ) : null}
                        {visibleCols.category ? <TableHead>category</TableHead> : null}
                        {visibleCols.source ? <TableHead>source</TableHead> : null}
                        {visibleCols.created_at ? <TableHead>created_at</TableHead> : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewSlice.map((row) => (
                        <TableRow
                          key={row.id}
                          className={cn(row.hasIssue && "bg-danger-soft/40")}
                        >
                          {visibleCols.instruction ? (
                            <TableCell className="max-w-[200px] truncate">
                              {row.instruction || "—"}
                            </TableCell>
                          ) : null}
                          {visibleCols.input ? (
                            <TableCell className="max-w-[200px] truncate">{row.input}</TableCell>
                          ) : null}
                          {visibleCols.expected_output ? (
                            <TableCell className="max-w-[160px] truncate">
                              {row.expected_output}
                            </TableCell>
                          ) : null}
                          {visibleCols.category ? (
                            <TableCell>{row.category}</TableCell>
                          ) : null}
                          {visibleCols.source ? <TableCell>{row.source}</TableCell> : null}
                          {visibleCols.created_at ? (
                            <TableCell className="text-ink-soft">
                              {row.created_at.slice(0, 10)}
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex items-center justify-between text-[13px]">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={previewPage === 0}
                    onClick={() => setPreviewPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <span className="text-ink-soft">
                    Page {previewPage + 1} of {previewPages}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={previewPage >= previewPages - 1}
                    onClick={() => setPreviewPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="space-y-4">
                {missingRequired ? (
                  <div className="flex items-center gap-2 rounded-lg border border-warning-border bg-warning-soft-3 px-3 py-2.5 text-[13px] text-warning">
                    <AlertTriangle className="size-4 shrink-0" />
                    Map required fields: instruction and expected_output.
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" className="h-8" onClick={handleAutoMap}>
                    Auto Map Schema
                  </Button>
                  <Button type="button" size="sm" variant="outline" className="h-8" onClick={handleResetMapping}>
                    Reset Mapping
                  </Button>
                </div>
                <div className="overflow-hidden rounded-lg border border-hairline bg-white">
                  <Table className="text-[13px]">
                    <TableHeader>
                      <TableRow className="bg-surface">
                        <TableHead>Dataset Column</TableHead>
                        <TableHead>Standard Field</TableHead>
                        <TableHead>Required</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Example</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mapping.map((row, idx) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium text-ink">{row.datasetColumn}</TableCell>
                          <TableCell>
                            <Select
                              items={[
                                { value: "__none__", label: "— Unmapped —" },
                                ...STANDARD_FIELDS.map((f) => ({ value: f, label: f })),
                              ]}
                              value={row.standardField || "__none__"}
                              onValueChange={(picked) => {
                                const value = (!picked || picked === "__none__"
                                  ? ""
                                  : picked) as StandardField | "";
                                const next = [...mapping];
                                next[idx] = {
                                  ...row,
                                  standardField: value,
                                  mappingStatus: value ? "Mapped" : "Missing",
                                };
                                setMapping(next);
                              }}
                            >
                              <SelectTrigger className="w-[180px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">— Unmapped —</SelectItem>
                                {STANDARD_FIELDS.map((f) => (
                                  <SelectItem key={f} value={f}>
                                    {f}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-ink-soft">
                            {row.required ? "Required" : "Optional"}
                          </TableCell>
                          <TableCell className="text-ink-soft">{row.dataType}</TableCell>
                          <TableCell className="max-w-[180px] truncate text-ink-soft">
                            {row.exampleValue}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}

            {step === 4 ? (
              <div className="space-y-4">
                <MockBanner>
                  Pemindaian kualitas otomatis (PII, konten toksik, quality score, deteksi
                  duplikat/missing) belum ada di backend Transformer Lab — angka di bawah masih
                  contoh (mock).
                </MockBanner>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                  {[
                    ["Total Rows", validation.summary.totalRows],
                    ["Valid Rows", validation.summary.validRows],
                    ["Invalid Rows", validation.summary.invalidRows],
                    ["Duplicates", validation.summary.duplicateRows],
                    ["Missing", validation.summary.missingValues],
                    ["PII", validation.summary.piiDetected],
                    ["Toxic", validation.summary.toxicContent],
                    ["Quality", `${validation.summary.dataQualityScore}%`],
                  ].map(([label, val]) => (
                    <div key={String(label)} className={cn(panelClassName, "px-3 py-2.5")}>
                      <p className="text-[10px] font-medium tracking-wide text-ink-faint uppercase">
                        {label}
                      </p>
                      <p className="mt-0.5 text-base font-semibold tabular-nums text-primary">
                        {typeof val === "number" ? formatNumber(val) : val}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {["Download Issue Report", "Remove Invalid Rows", "Mask PII", "Create Cleaned Version"].map(
                    (label) => (
                      <Button key={label} type="button" size="sm" variant="outline" className="h-8">
                        {label}
                      </Button>
                    )
                  )}
                </div>
                <div className="overflow-hidden rounded-lg border border-hairline bg-white">
                  <Table className="text-[13px]">
                    <TableHeader>
                      <TableRow className="bg-surface">
                        <TableHead>Row</TableHead>
                        <TableHead>Issue Type</TableHead>
                        <TableHead>Column</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Severity</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {validation.issues.map((issue) => (
                        <TableRow key={issue.id}>
                          <TableCell>{issue.rowNumber}</TableCell>
                          <TableCell>{issue.issueType}</TableCell>
                          <TableCell>{issue.column}</TableCell>
                          <TableCell>{issue.description}</TableCell>
                          <TableCell>{issue.severity}</TableCell>
                          <TableCell>{issue.action}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-[13px] text-ink-soft">
                  Status after validation:{" "}
                  <strong className={validation.summary.invalidRows > 0 ? "text-warning" : "text-success"}>
                    {validation.summary.invalidRows > 0 ? "Needs Review" : "Ready"}
                  </strong>
                </p>
              </div>
            ) : null}

            {step === 5 ? (
              <div className="mx-auto max-w-lg space-y-4">
                <Card className="border-hairline shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base font-semibold text-primary">
                      Review before save
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="space-y-0 text-[13px]">
                      <ReviewRow label="Dataset name" value={name} />
                      <ReviewRow label="Dataset type" value={datasetType} />
                      <ReviewRow label="Source" value={source ? sourceLabel(source) : "—"} />
                      <ReviewRow label="Total rows" value={formatNumber(validation.summary.totalRows)} />
                      <ReviewRow label="Valid rows" value={formatNumber(validation.summary.validRows)} />
                      <ReviewRow label="Invalid rows" value={formatNumber(validation.summary.invalidRows)} />
                      <ReviewRow
                        label="Validation status"
                        value={validation.summary.invalidRows > 0 ? "Needs Review" : "Ready"}
                      />
                      <ReviewRow
                        label="Schema mapping"
                        value={`${mapping.filter((m) => m.standardField).length} columns mapped`}
                      />
                      <ReviewRow label="Version" value="v1" />
                    </dl>
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </div>

          <footer className="flex flex-col gap-2 border-t border-hairline bg-surface px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              disabled={step === 0}
              onClick={() => setStep((s) => s - 1)}
            >
              <ArrowLeft className="size-3.5" />
              Back
            </Button>

            {step === WIZARD_STEPS.length - 1 ? (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" variant="outline" size="sm" className="h-8" onClick={handleSaveDraft}>
                  Save as Draft
                </Button>
                <Button type="button" size="sm" className="h-8" onClick={handleSave}>
                  Save Dataset
                </Button>
                <Button type="button" variant="secondary" size="sm" className="h-8" onClick={handleSaveAndUse}>
                  Save &amp; Use in Experiment
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5"
                disabled={(step === 0 && !source) || (step === 3 && missingRequired)}
                onClick={() => {
                  if (step === 0 && source === "Hugging Face") {
                    resetAndClose();
                    onOpenHuggingFaceImport?.();
                    return;
                  }
                  setStep((s) => s + 1);
                }}
              >
                Next
                <ArrowRight className="size-3.5" />
              </Button>
            )}
          </footer>
      </DialogContent>
    </Dialog>
  );
}

function WizardSelect({
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

function SummaryPill({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] font-medium tracking-wide text-ink-faint uppercase">{label}</p>
      <p className={cn("mt-0.5 text-sm font-semibold tabular-nums", warn ? "text-warning" : "text-primary")}>
        {value}
      </p>
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-surface-3 py-2.5 last:border-0">
      <dt className="text-ink-soft">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}
