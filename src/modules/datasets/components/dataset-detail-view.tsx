"use client";

import { Search, ExternalLink } from "lucide-react";
import { useState } from "react";

import { BreadcrumbNav } from "@/components/ui/breadcrumb";
import { Input } from "@/components/ui/input";
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
import {
  DETAIL_TABS,
  datasetUi,
  panelClassName,
  searchFieldClassName,
} from "@/modules/datasets/constants/dataset-ui";
import { useDatasetPreview } from "@/modules/datasets/hooks/use-dataset-preview";
import { formatDate, formatDateTime, formatNumber, sourceLabel } from "@/modules/datasets/lib/utils";
import type { Dataset, HuggingFaceDatasetSource } from "@/modules/datasets/types";
import { cn } from "@/lib/utils";

type DatasetDetailViewProps = {
  dataset: Dataset;
  onBack: () => void;
  onArchive: () => void;
};

export function DatasetDetailView({
  dataset,
  onBack,
  onArchive,
}: DatasetDetailViewProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [previewSearch, setPreviewSearch] = useState("");
  // Real rows from Transformer Lab (`/api/datasets/preview`).
  const { state: previewState, preview } = useDatasetPreview(dataset.id);

  const filteredRows = preview.rows.filter((r) => {
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
            datasetId={dataset.id}
            datasetName={dataset.name}
            onArchive={onArchive}
          />
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-lg border border-hairline bg-surface p-1">
          {DETAIL_TABS.filter((tab) => {
            if (tab.id === "huggingface" && dataset.source !== "Hugging Face") return false;
            return true;
          }).map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="text-[13px]">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {dataset.source === "Hugging Face" && dataset.huggingFaceSource ? (
          <TabsContent value="huggingface" className="mt-4">
            <HuggingFaceSourceTab source={dataset.huggingFaceSource} />
          </TabsContent>
        ) : null}

        <TabsContent value="overview" className="mt-4 space-y-4">
          <MetricGrid
            items={[
              ["Total Rows", formatNumber(dataset.totalRows)],
              ["Version", dataset.currentVersion],
              ["Format", dataset.format],
              ["Source", sourceLabel(dataset.source)],
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
            {previewState === "ready" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                <span className="size-1.5 rounded-full bg-emerald-500" /> Live from Transformer Lab
              </span>
            ) : null}
          </div>
          {previewState === "loading" ? (
            <p className="rounded-lg border border-dashed border-hairline px-4 py-8 text-center text-[13px] text-ink-soft">
              Memuat baris dataset…
            </p>
          ) : previewState === "ready" ? (
            <RealPreviewTable columns={preview.columns} rows={filteredRows} />
          ) : (
            <p className="rounded-lg border border-dashed border-hairline px-4 py-8 text-center text-[13px] text-ink-soft">
              Tidak ada preview untuk dataset ini.
            </p>
          )}
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
