"use client";

import { Archive, CheckCircle2, Database, FileWarning } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { datasetUi } from "@/modules/datasets/constants/dataset-ui";
import { formatNumber } from "@/modules/datasets/lib/utils";
import type { Dataset } from "@/modules/datasets/types";
import { cn } from "@/lib/utils";

type DatasetSummaryCardsProps = {
  datasets: Dataset[];
};

export function DatasetSummaryCards({ datasets }: DatasetSummaryCardsProps) {
  const active = datasets.filter((d) => d.validationStatus !== "Archived");
  const ready = active.filter((d) => d.validationStatus === "Ready" || d.validationStatus === "In Use");
  const needsReview = active.filter((d) => d.validationStatus === "Needs Review");
  const totalRows = active.reduce((sum, d) => sum + d.totalRows, 0);

  const cards = [
    {
      title: "Total Datasets",
      value: String(active.length),
      sub: `${datasets.length - active.length} archived`,
      icon: Database,
      iconBg: "bg-warning-soft",
      iconColor: "text-warning-gold",
    },
    {
      title: "Ready / In Use",
      value: String(ready.length),
      sub: "Production-ready assets",
      icon: CheckCircle2,
      iconBg: "bg-success-soft",
      iconColor: "text-success-bright",
    },
    {
      title: "Needs Review",
      value: String(needsReview.length),
      sub: "Requires validation action",
      icon: FileWarning,
      iconBg: "bg-warning-soft-2",
      iconColor: "text-warning",
    },
    {
      title: "Total Rows",
      value: formatNumber(totalRows),
      sub: "Across active datasets",
      icon: Archive,
      iconBg: "bg-info-soft",
      iconColor: "text-info-bright",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title} className="border-hairline shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-[14px] font-medium text-primary">{card.title}</CardTitle>
              <div className={cn("rounded p-1", card.iconBg)}>
                <card.icon className={cn("size-4", card.iconColor)} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className={cn("text-primary", datasetUi.metric)}>{card.value}</p>
            <p className="text-[13px] text-ink-soft">{card.sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
