"use client";

import { BookOpen, CheckCircle2, FileStack, FolderKanban } from "lucide-react";

import { SummaryCardGrid, type SummaryCard } from "@/components/ui/summary-card-grid";
import { documentsUi } from "@/modules/datasets/constants/documents-ui";
import type { DocumentsSummary } from "@/modules/datasets/lib/documents-utils";
import { formatNumber } from "@/modules/datasets/lib/utils";

type DocumentsSummaryCardsProps = {
  summary: DocumentsSummary;
};

export function DocumentsSummaryCards({ summary }: DocumentsSummaryCardsProps) {
  const cards: SummaryCard[] = [
    {
      label: "Knowledge Bases",
      value: String(summary.knowledgeBaseCount),
      sub: `${summary.readyCount} ready for Q&A`,
      icon: FolderKanban,
      iconWrapClassName: "bg-warning-soft",
      iconClassName: "text-warning-gold",
    },
    {
      label: "Documents",
      value: String(summary.documentCount),
      sub: "Source files uploaded",
      icon: FileStack,
      iconWrapClassName: "bg-info-soft",
      iconClassName: "text-info-bright",
    },
    {
      label: "Passages",
      value: formatNumber(summary.passageCount),
      sub: "Indexed for search",
      icon: BookOpen,
      iconWrapClassName: "bg-purple-soft",
      iconClassName: "text-purple-solid",
    },
    {
      label: "Needs Indexing",
      value: String(summary.needsIndexCount),
      sub: "Knowledge bases to update",
      icon: CheckCircle2,
      iconWrapClassName: "bg-warning-soft-2",
      iconClassName: "text-warning",
    },
  ];

  return (
    <SummaryCardGrid
      cards={cards}
      columns={4}
      cardClassName="border-hairline shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
      titleClassName="text-sm font-medium text-primary"
      contentClassName="space-y-1"
      metricClassName={documentsUi.metric}
    />
  );
}
