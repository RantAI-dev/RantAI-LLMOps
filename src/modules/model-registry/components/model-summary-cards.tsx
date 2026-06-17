"use client";

import { Boxes, CheckCircle2, Eye, Rocket } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { modelRegistryUi } from "@/modules/model-registry/constants/model-registry-ui";
import { cn } from "@/lib/utils";

type ModelSummaryCardsProps = {
  stats: {
    total: number;
    readyToDeploy: number;
    needReview: number;
    inProduction: number;
  };
};

export function ModelSummaryCards({ stats }: ModelSummaryCardsProps) {
  const cards = [
    { label: "Total Models", value: stats.total, icon: Boxes, iconBg: "bg-warning-soft", iconColor: "text-warning-gold" },
    { label: "Ready to Deploy", value: stats.readyToDeploy, icon: CheckCircle2, iconBg: "bg-success-soft", iconColor: "text-success-bright" },
    { label: "Need Review", value: stats.needReview, icon: Eye, iconBg: "bg-warning-soft-2", iconColor: "text-warning-solid" },
    { label: "Running in Production", value: stats.inProduction, icon: Rocket, iconBg: "bg-info-soft", iconColor: "text-info-bright" },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label} className="shadow-[0_1px_2px_rgba(0,0,0,0.1)]">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="font-medium text-primary">{card.label}</CardTitle>
              <div className={cn("rounded p-1", card.iconBg)}>
                <card.icon className={cn("size-4", card.iconColor)} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className={cn("text-primary", modelRegistryUi.metric)}>{card.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
