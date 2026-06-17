"use client";

import { Archive, CheckCircle2, Database, FileWarning } from "lucide-react";

import { SummaryCardGrid, type SummaryCard } from "@/components/ui/summary-card-grid";
import { datasetUi } from "@/modules/datasets/constants/dataset-ui";
import { formatNumber } from "@/modules/datasets/lib/utils";
import type { Dataset } from "@/modules/datasets/types";

type DatasetSummaryCardsProps = {
  datasets: Dataset[];
};

export function DatasetSummaryCards({ datasets }: DatasetSummaryCardsProps) {
  const active = datasets.filter((d) => d.validationStatus !== "Archived");
  const ready = active.filter((d) => d.validationStatus === "Ready" || d.validationStatus === "In Use");
  const needsReview = active.filter((d) => d.validationStatus === "Needs Review");
  const totalRows = active.reduce((sum, d) => sum + d.totalRows, 0);

  const cards: SummaryCard[] = [
    {
      label: "Total Datasets",
      value: String(active.length),
      sub: `${datasets.length - active.length} archived`,
      icon: Database,
      iconWrapClassName: "bg-warning-soft",
      iconClassName: "text-warning-gold",
    },
    {
      label: "Ready / In Use",
      value: String(ready.length),
      sub: "Production-ready assets",
      icon: CheckCircle2,
      iconWrapClassName: "bg-success-soft",
      iconClassName: "text-success-bright",
    },
    {
      label: "Needs Review",
      value: String(needsReview.length),
      sub: "Requires validation action",
      icon: FileWarning,
      iconWrapClassName: "bg-warning-soft-2",
      iconClassName: "text-warning",
    },
    {
      label: "Total Rows",
      value: formatNumber(totalRows),
      sub: "Across active datasets",
      icon: Archive,
      iconWrapClassName: "bg-info-soft",
      iconClassName: "text-info-bright",
    },
  ];

  return (
    <SummaryCardGrid
      cards={cards}
      columns={4}
      cardClassName="border-hairline shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
      titleClassName="text-sm font-medium text-primary"
      contentClassName="space-y-1"
      metricClassName={datasetUi.metric}
    />
  );
}
