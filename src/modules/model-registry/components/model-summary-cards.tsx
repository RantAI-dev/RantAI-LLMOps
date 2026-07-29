"use client";

import { Boxes } from "lucide-react";

import { SummaryCardGrid, type SummaryCard } from "@/components/ui/summary-card-grid";
import { modelRegistryUi } from "@/modules/model-registry/constants/model-registry-ui";

type ModelSummaryCardsProps = {
  stats: {
    total: number;
    readyToDeploy: number;
    needReview: number;
    inProduction: number;
  };
};

// Only the real count is shown. The backend catalog carries no per-model lifecycle
// status, so "Ready to Deploy", "Need Review" and "Running in Production" were
// hardcoded constants (Ready/NeedReview always equalled Total, Production always 0) —
// removed rather than show fabricated status.
export function ModelSummaryCards({ stats }: ModelSummaryCardsProps) {
  const cards: SummaryCard[] = [
    {
      label: "Total Models",
      value: stats.total,
      icon: Boxes,
      iconWrapClassName: "bg-warning-soft",
      iconClassName: "text-warning-gold",
    },
  ];

  return (
    <SummaryCardGrid
      cards={cards}
      columns={4}
      cardClassName="shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
      titleClassName="font-medium text-primary"
      metricClassName={modelRegistryUi.metric}
    />
  );
}
