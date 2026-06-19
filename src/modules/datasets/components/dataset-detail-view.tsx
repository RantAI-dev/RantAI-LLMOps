"use client";

import { Search, ExternalLink } from "lucide-react";
import { useState } from "react";

import { BreadcrumbNav } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MockBanner } from "@/components/ui/mock-banner";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DatasetDetailToolbar } from "@/modules/datasets/components/dataset-detail-toolbar";
import { DatasetStatusBadge } from "@/modules/datasets/components/dataset-status-badge";
import { RagChunksTab } from "@/modules/datasets/components/rag/rag-chunks-tab";
import { RagDocumentsTab } from "@/modules/datasets/components/rag/rag-documents-tab";
import { RagIndexTab } from "@/modules/datasets/components/rag/rag-index-tab";
import {
  DETAIL_TABS,
  datasetUi,
  panelClassName,
  searchFieldClassName,
} from "@/modules/datasets/constants/dataset-ui";
import { INVOICE_PREVIEW_ROWS } from "@/modules/datasets/data/preview-rows";
import { useDatasetPreview } from "@/modules/datasets/hooks/use-dataset-preview";
import {
  formatDate,
  formatDateTime,
  formatNumber,
  sourceLabel,
  splitRowCounts,
  splitTotal,
} from "@/modules/datasets/lib/utils";
import type {
  Dataset,
  DatasetSplit,
  HuggingFaceDatasetSource,
  RagIndexConfig,
  SchemaMappingRow,
} from "@/modules/datasets/types";
import { cn } from "@/lib/utils";

type DatasetDetailViewProps = {
  dataset: Dataset;
  onBack: () => void;
  onValidateAgain: () => void;
  onCreateVersion: () => void;
  onArchive: () => void;
  onUseInExperiment: () => void;
  onSaveSplit: (split: DatasetSplit) => void;
  onUpdateMapping: (mapping: SchemaMappingRow[]) => void;
  onSetActiveVersion: (versionId: string) => void;
  onRollback: (versionId: string) => void;
  onUploadRagDocument?: (fileName: string, sizeBytes: number) => void;
  onRemoveRagDocument?: (documentId: string) => void;
  onUpdateRagIndexConfig?: (config: Partial<RagIndexConfig>) => void;
  onReindexRag?: () => Promise<void>;
};

export function DatasetDetailView({
  dataset,
  onBack,
  onValidateAgain,
  onCreateVersion,
  onArchive,
  onUseInExperiment,
  onSaveSplit,
  onUpdateMapping,
  onSetActiveVersion,
  onRollback,
  onUploadRagDocument,
  onRemoveRagDocument,
  onUpdateRagIndexConfig,
  onReindexRag,
}: DatasetDetailViewProps) {
  const isRagKb = dataset.datasetType === "RAG Knowledge Base";
  const [activeTab, setActiveTab] = useState(isRagKb ? "rag-documents" : "overview");
  const [isIndexing, setIsIndexing] = useState(false);
  const [split, setSplit] = useState(dataset.split);
  const [mapping, setMapping] = useState(dataset.schemaMapping);
  const [previewFilter, setPreviewFilter] = useState<"all" | "valid" | "invalid">("all");
  const [previewSearch, setPreviewSearch] = useState("");
  // Real rows from Transformer Lab; falls back to the mock sample for datasets
  // TL doesn't have (the demo fixtures).
  const { state: previewState, preview: realPreview } = useDatasetPreview(dataset.id);
  const useRealPreview = previewState === "ready";

  const splitSum = splitTotal(split);
  const splitError = splitSum > 100;
  const splitRemaining = 100 - splitSum;
  const rowCounts = splitRowCounts(dataset.validRows, split);

  const filteredRows = INVOICE_PREVIEW_ROWS.filter((r) => {
    const q = previewSearch.trim().toLowerCase();
    if (previewFilter === "valid" && r.hasIssue) return false;
    if (previewFilter === "invalid" && !r.hasIssue) return false;
    if (!q) return true;
    return Object.values(r).some((v) => String(v).toLowerCase().includes(q));
  });

  // Real TL rows: no validity concept (TL doesn't validate), so only search.
  const realFilteredRows = realPreview.rows.filter((r) => {
    const q = previewSearch.trim().toLowerCase();
    if (!q) return true;
    return Object.values(r).some((v) => v.toLowerCase().includes(q));
  });

  return (
    <article className="min-w-0 w-full space-y-3">
      <header className="space-y-2 border-b border-hairline pb-3">
        <BreadcrumbNav
          items={[
            { label: "Dataset Library", onClick: onBack },
            { label: dataset.name },
          ]}
        />
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <DatasetStatusBadge status={dataset.validationStatus} />
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium tabular-nums text-ink">
                {dataset.currentVersion}
              </span>
              <h1 className={datasetUi.detailTitle}>{dataset.name}</h1>
            </div>
          </div>
          <DatasetDetailToolbar
            onValidateAgain={onValidateAgain}
            onCreateVersion={onCreateVersion}
            onUseInExperiment={onUseInExperiment}
            onArchive={onArchive}
          />
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-lg border border-hairline bg-surface p-1">
          {DETAIL_TABS.filter((tab) => {
            if ("ragOnly" in tab && tab.ragOnly && !isRagKb) return false;
            if (tab.id === "huggingface" && dataset.source !== "Hugging Face") return false;
            return true;
          }).map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="text-[13px]">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {isRagKb && dataset.rag && onUploadRagDocument && onRemoveRagDocument && onReindexRag ? (
          <>
            <TabsContent value="rag-documents" className="mt-4">
              <RagDocumentsTab
                dataset={dataset}
                onUpload={onUploadRagDocument}
                onRemove={onRemoveRagDocument}
                onReindex={() => {
                  setIsIndexing(true);
                  void onReindexRag().finally(() => setIsIndexing(false));
                }}
                isIndexing={isIndexing}
              />
            </TabsContent>
            {onUpdateRagIndexConfig ? (
              <TabsContent value="rag-index" className="mt-4">
                <RagIndexTab
                  dataset={dataset}
                  onSave={onUpdateRagIndexConfig}
                  onReindex={() => {
                    setIsIndexing(true);
                    void onReindexRag().finally(() => setIsIndexing(false));
                  }}
                />
              </TabsContent>
            ) : null}
            <TabsContent value="rag-chunks" className="mt-4">
              <RagChunksTab dataset={dataset} />
            </TabsContent>
          </>
        ) : null}

        {dataset.source === "Hugging Face" && dataset.huggingFaceSource ? (
          <TabsContent value="huggingface" className="mt-4">
            <HuggingFaceSourceTab source={dataset.huggingFaceSource} />
          </TabsContent>
        ) : null}

        <TabsContent value="overview" className="mt-4 space-y-4">
          <MetricGrid
            items={[
              ["Total Rows", formatNumber(dataset.totalRows)],
              ["Valid Rows", formatNumber(dataset.validRows)],
              ["Invalid Rows", formatNumber(dataset.invalidRows)],
              ["Quality Score", `${dataset.validationSummary.dataQualityScore}%`],
              ["PII Detected", String(dataset.validationSummary.piiDetected)],
              ["Duplicates", formatNumber(dataset.validationSummary.duplicateRows)],
              ["Version", dataset.currentVersion],
              ["Usage Count", String(dataset.usageCount)],
            ]}
          />
          <CardSection title="Metadata">
            <MetaGrid
              rows={[
                ["Dataset Type", dataset.datasetType],
                ["Source", sourceLabel(dataset.source)],
                ["Format", dataset.format],
                ["Access Level", dataset.accessLevel],
                ["Owner", dataset.owner],
                ["Created", formatDate(dataset.createdAt)],
                ["Last Updated", formatDateTime(dataset.lastUpdated)],
                ["Tags", dataset.tags.join(", ") || "—"],
                ["Description", dataset.description],
              ]}
            />
          </CardSection>
          <CardSection title="Dataset Readiness">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  ["Fine-tuning", dataset.readiness.fineTuning],
                  ["Evaluation", dataset.readiness.evaluation],
                  ["RAG Knowledge Base", dataset.readiness.ragKnowledgeBase],
                  ["Prompt Testing", dataset.readiness.promptTesting],
                  ["Agent Benchmark", dataset.readiness.agentBenchmark],
                ] as const
              ).map(([label, level]) => (
                <ReadinessBadge key={label} label={label} level={level} />
              ))}
            </div>
          </CardSection>
        </TabsContent>

        <TabsContent value="preview" className="mt-4 space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-primary/70" />
              <Input
                value={previewSearch}
                onChange={(e) => setPreviewSearch(e.target.value)}
                placeholder="Search rows..."
                className={searchFieldClassName}
              />
            </div>
            {!useRealPreview ? (
              <div className="flex flex-wrap gap-1.5">
                {(["all", "valid", "invalid"] as const).map((f) => (
                  <Button
                    key={f}
                    type="button"
                    size="sm"
                    variant={previewFilter === f ? "default" : "outline"}
                    className="h-8"
                    onClick={() => setPreviewFilter(f)}
                  >
                    {f === "all" ? "All rows" : f === "valid" ? "Valid only" : "Invalid only"}
                  </Button>
                ))}
              </div>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                <span className="size-1.5 rounded-full bg-emerald-500" /> Live from Transformer Lab
              </span>
            )}
          </div>
          {previewState === "loading" ? (
            <p className="rounded-lg border border-dashed border-hairline px-4 py-8 text-center text-[13px] text-ink-soft">
              Memuat baris dataset…
            </p>
          ) : useRealPreview ? (
            <RealPreviewTable columns={realPreview.columns} rows={realFilteredRows} />
          ) : (
            <PreviewTable rows={filteredRows} />
          )}
        </TabsContent>

        <TabsContent value="schema" className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" className="h-8" onClick={() => onUpdateMapping(mapping)}>
              Save Mapping
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => setMapping(dataset.schemaMapping)}
            >
              Auto Map Again
            </Button>
          </div>
          <SchemaTable mapping={mapping} />
        </TabsContent>

        <TabsContent value="validation" className="mt-4 space-y-4">
          <MockBanner>
            Validasi & skor kualitas otomatis (PII, konten toksik, quality score) belum ada di
            backend Transformer Lab — angka di bawah masih contoh (mock).
          </MockBanner>
          <MetricGrid
            items={[
              ["Quality Score", `${dataset.validationSummary.dataQualityScore}%`],
              ["Missing Value", String(dataset.validationSummary.missingValues)],
              ["Duplicate", String(dataset.validationSummary.duplicateRows)],
              ["Invalid Format", "12"],
              ["PII Detected", String(dataset.validationSummary.piiDetected)],
              ["Toxic Content", String(dataset.validationSummary.toxicContent)],
              ["Schema Mismatch", "3"],
            ]}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline">
              Fix Issues
            </Button>
            <Button type="button" size="sm" variant="outline">
              Create Cleaned Version
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onValidateAgain}>
              Re-run Validation
            </Button>
            <Button type="button" size="sm" variant="outline">
              Download Issue Report
            </Button>
          </div>
          <IssuesTable issues={dataset.issues} />
        </TabsContent>

        <TabsContent value="versions" className="mt-4">
          <div className="overflow-hidden rounded-lg border border-hairline bg-white">
            <Table className="text-[13px]">
              <TableHeader>
                <TableRow className="bg-surface">
                  <TableHead>Version</TableHead>
                  <TableHead>Changes</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Quality</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dataset.versions.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-medium">
                      {v.version}
                      {v.isActive ? (
                        <span className="ml-1 text-[11px] text-success-bright">(active)</span>
                      ) : null}
                    </TableCell>
                    <TableCell>{v.changes}</TableCell>
                    <TableCell className="tabular-nums">{formatNumber(v.rows)}</TableCell>
                    <TableCell>
                      <DatasetStatusBadge status={v.validationStatus} />
                    </TableCell>
                    <TableCell>{v.qualityScore}%</TableCell>
                    <TableCell>{v.createdBy}</TableCell>
                    <TableCell>{formatDate(v.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button type="button" size="xs" variant="ghost">
                          View
                        </Button>
                        <Button type="button" size="xs" variant="ghost">
                          Compare
                        </Button>
                        {!v.isActive ? (
                          <>
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              onClick={() => onRollback(v.id)}
                            >
                              Rollback
                            </Button>
                            <Button
                              type="button"
                              size="xs"
                              onClick={() => onSetActiveVersion(v.id)}
                            >
                              Set Active
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="split" className="mt-4 space-y-4">
          <div className={cn(panelClassName, "p-4")}>
            <p className="text-[13px] text-ink-soft">
              Total rows:{" "}
              <strong className="font-semibold text-ink">
                {formatNumber(dataset.validRows)}
              </strong>
            </p>
            {(["training", "validation", "testing", "evaluation"] as const).map((key) => (
              <div key={key} className="mt-4 space-y-2">
                <div className="flex justify-between text-[13px]">
                  <span className="font-medium capitalize text-ink">{key}</span>
                  <span className="tabular-nums text-ink-soft">
                    {split[key]}% · {formatNumber(rowCounts[key])} rows
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={split[key]}
                  onChange={(e) =>
                    setSplit((s) => ({ ...s, [key]: Number(e.target.value) }))
                  }
                  className="h-1.5 w-full accent-primary"
                />
                <Progress value={split[key]} className="h-1" />
              </div>
            ))}
          </div>
          {splitError ? (
            <p className="text-[13px] text-danger">
              Total split exceeds 100%. Reduce percentages to save.
            </p>
          ) : splitRemaining > 0 ? (
            <p className="text-[13px] text-ink-soft">
              Remaining: {splitRemaining}% unallocated
            </p>
          ) : (
            <p className="text-[13px] text-success-bright">Split totals 100%</p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={splitError}
              onClick={() => onSaveSplit(split)}
            >
              Save Split
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setSplit({ training: 80, validation: 10, testing: 10, evaluation: 0 })}
            >
              Reset Split
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="usage" className="mt-4">
          <div className="relative space-y-4 border-l-2 border-primary/20 pl-6">
            {dataset.usage.length === 0 ? (
              <p className="text-sm text-ink-soft">No usage recorded yet.</p>
            ) : (
              dataset.usage.map((item) => (
                <div key={item.id} className="relative">
                  <span className="absolute -left-[31px] top-2 size-3 rounded-full border-2 border-primary bg-white" />
                  <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-primary/80">
                      {item.category}
                    </p>
                    <p className="mt-1 font-semibold text-ink">{item.title}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
                      <span>Status: {item.status}</span>
                      <span>Version: {item.datasetVersion}</span>
                      <span>Since: {formatDate(item.usedSince)}</span>
                      {item.result ? <span>{item.result}</span> : null}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <div className="space-y-3">
            {dataset.activityLog.map((log) => (
              <div
                key={log.id}
                className="flex gap-4 border-b border-border pb-3 last:border-0"
              >
                <time className="w-36 shrink-0 text-xs text-ink-soft">
                  {formatDateTime(log.timestamp)}
                </time>
                <div>
                  <p className="text-[13px] font-medium text-ink">
                    {log.actor} — {log.activity}
                  </p>
                  <p className="text-[13px] text-ink-soft">{log.description}</p>
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </article>
  );
}

function MetricGrid({ items }: { items: [string, string][] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className={cn(panelClassName, "px-3 py-2.5")}>
          <p className="text-[10px] font-medium tracking-wide text-ink-faint uppercase">
            {label}
          </p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-primary">{value}</p>
        </div>
      ))}
    </div>
  );
}

function CardSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={cn(panelClassName, "p-4")}>
      <h3 className="mb-3 text-sm font-semibold text-primary">{title}</h3>
      {children}
    </div>
  );
}

function MetaGrid({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid gap-2 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="text-[13px]">
          <dt className="text-ink-soft">{k}</dt>
          <dd className="font-medium text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function ReadinessBadge({
  label,
  level,
}: {
  label: string;
  level: "Ready" | "Need Review" | "Not Configured";
}) {
  const styles = {
    Ready: "bg-success-soft text-success",
    "Need Review": "bg-warning-soft-2 text-warning",
    "Not Configured": "bg-surface-2 text-ink-faint-strong",
  };
  return (
    <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
      <span className="text-[13px] text-ink">{label}</span>
      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", styles[level])}>
        {level}
      </span>
    </div>
  );
}

function PreviewTable({
  rows,
}: {
  rows: typeof INVOICE_PREVIEW_ROWS;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-white">
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow className="bg-surface">
            <TableHead className="w-8" />
            <TableHead>instruction</TableHead>
            <TableHead>input</TableHead>
            <TableHead>expected_output</TableHead>
            <TableHead>category</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              className={cn(row.hasIssue && "bg-danger-soft/40")}
            >
              <TableCell>
                {row.hasIssue ? (
                  <span className="text-danger" title="Has issue">
                    ⚠
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="max-w-[180px] truncate">{row.instruction || "—"}</TableCell>
              <TableCell className="max-w-[180px] truncate">{row.input}</TableCell>
              <TableCell>{row.expected_output}</TableCell>
              <TableCell>{row.category}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Renders real TL rows with whatever columns the dataset actually has. */
function RealPreviewTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Array<Record<string, string>>;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-hairline px-4 py-8 text-center text-[13px] text-ink-soft">
        Tidak ada baris yang cocok.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow className="bg-surface">
            {columns.map((c) => (
              <TableHead key={c} className="whitespace-nowrap">
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow key={i}>
              {columns.map((c) => (
                <TableCell key={c} className="max-w-[280px] truncate align-top" title={row[c]}>
                  {row[c] || "—"}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SchemaTable({ mapping }: { mapping: SchemaMappingRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-white">
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow className="bg-surface">
            <TableHead>Dataset Column</TableHead>
            <TableHead>Standard Field</TableHead>
            <TableHead>Required</TableHead>
            <TableHead>Data Type</TableHead>
            <TableHead>Example</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {mapping.map((row) => (
            <TableRow key={row.id}>
              <TableCell>{row.datasetColumn}</TableCell>
              <TableCell>{row.standardField || "—"}</TableCell>
              <TableCell>{row.required ? "Yes" : "No"}</TableCell>
              <TableCell>{row.dataType}</TableCell>
              <TableCell className="max-w-[140px] truncate">{row.exampleValue}</TableCell>
              <TableCell>{row.mappingStatus}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function IssuesTable({
  issues,
}: {
  issues: Dataset["issues"];
}) {
  return (
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
          {issues.map((issue) => (
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
  );
}

function HuggingFaceSourceTab({ source }: { source: HuggingFaceDatasetSource }) {
  return (
    <CardSection title="Hugging Face load_dataset parameters">
      <MetaGrid
        rows={[
          ["path (repo_id)", source.repoId],
          ["name (config)", source.config],
          ["split", source.split],
          ["revision", source.revision],
          ["streaming", source.streaming ? "true" : "false"],
          ["trust_remote_code", source.trustRemoteCode ? "true" : "false"],
          ["Import Mode", source.importMode],
          ["License", source.license],
          ["Task Categories", source.taskCategories.join(", ")],
        ]}
      />
      <a
        href={source.repoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-flex items-center gap-1 text-[13px] text-primary hover:underline"
      >
        Open on Hugging Face
        <ExternalLink className="size-3.5" />
      </a>
    </CardSection>
  );
}
