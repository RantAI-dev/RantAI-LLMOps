"use client";

import { BookOpen, CheckCircle2, FileStack, FolderKanban } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { documentsUi } from "@/modules/datasets/constants/documents-ui";
import type { DocumentsSummary } from "@/modules/datasets/lib/documents-utils";
import { formatNumber } from "@/modules/datasets/lib/utils";
import { cn } from "@/lib/utils";

type DocumentsSummaryCardsProps = {
  summary: DocumentsSummary;
};

export function DocumentsSummaryCards({ summary }: DocumentsSummaryCardsProps) {
  const cards = [
    {
      title: "Knowledge Bases",
      value: String(summary.knowledgeBaseCount),
      sub: `${summary.readyCount} ready for Q&A`,
      icon: FolderKanban,
      iconBg: "bg-warning-soft",
      iconColor: "text-warning-gold",
    },
    {
      title: "Documents",
      value: String(summary.documentCount),
      sub: "Source files uploaded",
      icon: FileStack,
      iconBg: "bg-info-soft",
      iconColor: "text-info-bright",
    },
    {
      title: "Passages",
      value: formatNumber(summary.passageCount),
      sub: "Indexed for search",
      icon: BookOpen,
      iconBg: "bg-purple-soft",
      iconColor: "text-purple-solid",
    },
    {
      title: "Needs Indexing",
      value: String(summary.needsIndexCount),
      sub: "Knowledge bases to update",
      icon: CheckCircle2,
      iconBg: "bg-warning-soft-2",
      iconColor: "text-warning",
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
            <p className={cn("text-primary", documentsUi.metric)}>{card.value}</p>
            <p className="text-[13px] text-ink-soft">{card.sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
