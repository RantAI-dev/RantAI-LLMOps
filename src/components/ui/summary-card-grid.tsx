import type { ComponentType } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type SummaryCard = {
  label: string;
  value: string | number;
  icon: ComponentType<{ className?: string }>;
  /** Classes for the icon wrapper (background, plus text color when the icon inherits it). */
  iconWrapClassName: string;
  /** Optional explicit icon color (when the wrapper only sets a background). */
  iconClassName?: string;
  /** Optional sub-label rendered under the metric value. */
  sub?: string;
};

const GRID_COLS: Record<number, string> = {
  4: "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4",
  6: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6",
  7: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-7",
};

/**
 * Shared KPI summary-card grid used by Tasks, Experiments, Datasets, Documents
 * and Model Registry. Each module still owns its per-card data; this component
 * owns the repeated grid + Card + header/metric layout. The style props let a
 * caller keep its exact look while sharing the structure.
 */
export function SummaryCardGrid({
  cards,
  columns,
  cardClassName,
  headerClassName,
  titleClassName,
  contentClassName,
  metricClassName,
}: {
  cards: SummaryCard[];
  columns: 4 | 6 | 7;
  cardClassName?: string;
  headerClassName?: string;
  titleClassName?: string;
  contentClassName?: string;
  metricClassName?: string;
}) {
  return (
    <div className={cn("grid gap-3", GRID_COLS[columns])}>
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <Card key={card.label} className={cardClassName}>
            <CardHeader className={headerClassName}>
              <div className="flex items-center justify-between gap-2">
                <CardTitle className={titleClassName}>{card.label}</CardTitle>
                <div className={cn("rounded p-1", card.iconWrapClassName)}>
                  <Icon className={cn("size-4", card.iconClassName)} />
                </div>
              </div>
            </CardHeader>
            <CardContent className={contentClassName}>
              <p className={cn("text-primary", metricClassName)}>{card.value}</p>
              {card.sub ? <p className="text-[13px] text-ink-soft">{card.sub}</p> : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
