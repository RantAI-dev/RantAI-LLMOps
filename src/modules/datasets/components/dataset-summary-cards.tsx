"use client";

import { Database } from "lucide-react";

import { SummaryCardGrid, type SummaryCard } from "@/components/ui/summary-card-grid";
import { datasetUi } from "@/modules/datasets/constants/dataset-ui";
import type { Dataset } from "@/modules/datasets/types";

type DatasetSummaryCardsProps = {
  datasets: Dataset[];
};

// Only the real count is shown. Transformer Lab's `/data/list` exposes no per-row
// validation status or row count, so "Ready/In Use", "Needs Review" and "Total Rows"
// were fabricated/always-zero buckets — removed rather than show fake metrics.
export function DatasetSummaryCards({ datasets }: DatasetSummaryCardsProps) {
  const cards: SummaryCard[] = [
    {
      label: "Total Datasets",
      value: String(datasets.length),
      sub: "Registered on the Transformer Lab disk",
      icon: Database,
      iconWrapClassName: "bg-warning-soft",
      iconClassName: "text-warning-gold",
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
