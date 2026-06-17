"use client";

import { Boxes, CheckCircle2, Eye, Rocket } from "lucide-react";

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

export function ModelSummaryCards({ stats }: ModelSummaryCardsProps) {
  const cards: SummaryCard[] = [
    { label: "Total Models", value: stats.total, icon: Boxes, iconWrapClassName: "bg-warning-soft", iconClassName: "text-warning-gold" },
    { label: "Ready to Deploy", value: stats.readyToDeploy, icon: CheckCircle2, iconWrapClassName: "bg-success-soft", iconClassName: "text-success-bright" },
    { label: "Need Review", value: stats.needReview, icon: Eye, iconWrapClassName: "bg-warning-soft-2", iconClassName: "text-warning-solid" },
    { label: "Running in Production", value: stats.inProduction, icon: Rocket, iconWrapClassName: "bg-info-soft", iconClassName: "text-info-bright" },
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
