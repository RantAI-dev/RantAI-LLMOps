import {
  CheckCircle2,
  Clock,
  Layers,
  ListOrdered,
  PlayCircle,
  XCircle,
} from "lucide-react";

import { SummaryCardGrid, type SummaryCard } from "@/components/ui/summary-card-grid";
import { taskUi } from "@/modules/tasks/constants/task-ui";
import { averageDurationMs, formatDuration, taskStatus } from "@/modules/tasks/lib/utils";
import type { Task } from "@/modules/tasks/types";

type TaskSummaryCardsProps = {
  tasks: Task[];
};

export function TaskSummaryCards({ tasks }: TaskSummaryCardsProps) {
  const total = tasks.length;
  const running = tasks.filter((t) => {
    const s = taskStatus(t);
    return s === "Running" || s === "Retrying";
  }).length;
  const queued = tasks.filter((t) => taskStatus(t) === "Queued").length;
  const completed = tasks.filter((t) => taskStatus(t) === "Completed").length;
  const failed = tasks.filter((t) => taskStatus(t) === "Failed").length;
  const avgDuration = formatDuration(averageDurationMs(tasks));

  // NOTE: no "Active GPU" card — Transformer Lab doesn't expose per-job GPU
  // telemetry, so it would always read 0%. Better to omit than show a fake metric.
  const cards: SummaryCard[] = [
    { label: "Total Tasks", value: String(total), icon: Layers, iconWrapClassName: "bg-primary-soft text-primary" },
    { label: "Running", value: String(running), icon: PlayCircle, iconWrapClassName: "bg-warning-soft text-warning" },
    { label: "Queued", value: String(queued), icon: ListOrdered, iconWrapClassName: "bg-info-soft text-info" },
    { label: "Completed", value: String(completed), icon: CheckCircle2, iconWrapClassName: "bg-success-soft text-success" },
    { label: "Failed", value: String(failed), icon: XCircle, iconWrapClassName: "bg-danger-soft text-danger" },
    { label: "Avg Duration", value: avgDuration, icon: Clock, iconWrapClassName: "bg-purple-soft text-purple" },
  ];

  return (
    <SummaryCardGrid
      cards={cards}
      columns={6}
      cardClassName="shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
      headerClassName="pb-1"
      titleClassName="text-[13px] font-medium text-ink-soft"
      contentClassName="pt-0"
      metricClassName={taskUi.metric}
    />
  );
}
