"use client";

import { Archive, Eye, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DatasetStatusBadge } from "@/modules/datasets/components/dataset-status-badge";
import {
  formatDateTime,
  formatNumber,
  sourceLabel,
} from "@/modules/datasets/lib/utils";
import type { Dataset } from "@/modules/datasets/types";
import { cn } from "@/lib/utils";

type DatasetCardProps = {
  dataset: Dataset;
  onView: () => void;
  onArchive: () => void;
};

export function DatasetCard({
  dataset,
  onView,
  onArchive,
}: DatasetCardProps) {
  return (
    <Card className="flex flex-col overflow-hidden border-hairline bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-[border-color,box-shadow] hover:border-primary/20 hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <DatasetStatusBadge status={dataset.validationStatus} />
          <span className="text-[11px] tabular-nums text-ink-faint">{dataset.currentVersion}</span>
        </div>

        <div className="min-w-0 space-y-1">
          <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-primary">
            {dataset.name}
          </h3>
          <p className="text-xs text-ink-soft">
            {dataset.datasetType} · {sourceLabel(dataset.source)} · {dataset.currentVersion}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[13px] text-ink sm:grid-cols-3">
          <Stat label="Rows" value={formatNumber(dataset.totalRows)} />
          <Stat label="Valid Rows" value={formatNumber(dataset.validRows)} />
          <Stat
            label="Issues"
            value={`${formatNumber(dataset.invalidRows)} rows`}
            warn={dataset.invalidRows > 0}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
          <span>
            Status: <strong className="font-medium text-ink">{dataset.validationStatus}</strong>
          </span>
          <span>·</span>
          <span>Used by: {dataset.usageCount} workflows</span>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-ink-faint">
          <User className="size-3 shrink-0" />
          <span>{dataset.owner}</span>
          <span>·</span>
          <span>{formatDateTime(dataset.lastUpdated)}</span>
        </div>

        {dataset.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {dataset.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-primary-soft/80 px-2 py-0.5 text-[11px] font-medium text-primary-strong"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <footer
        className="flex flex-wrap gap-2 border-t border-surface-3 bg-surface/80 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <Button type="button" size="sm" variant="outline" className="h-8" onClick={onView}>
          <Eye className="size-3.5" />
          View Detail
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-8" onClick={onArchive}>
          <Archive className="size-3.5" />
          Archive
        </Button>
      </footer>
    </Card>
  );
}

function Stat({
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
      <p className={cn("mt-0.5 font-semibold tabular-nums", warn ? "text-danger" : "text-primary")}>
        {value}
      </p>
    </div>
  );
}
