import {
  CheckCircle2,
  Clock,
  Cpu,
  Layers,
  ListOrdered,
  PlayCircle,
  XCircle,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { taskUi } from "@/modules/tasks/constants/task-ui";
import { activeGpuUsage, averageDurationMs, formatDuration, taskStatus } from "@/modules/tasks/lib/utils";
import type { Task } from "@/modules/tasks/types";
import { cn } from "@/lib/utils";

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
  const gpuUsage = activeGpuUsage(tasks);

  const cards = [
    { label: "Total Tasks", value: String(total), icon: Layers, tint: "bg-primary-soft text-primary" },
    { label: "Running", value: String(running), icon: PlayCircle, tint: "bg-warning-soft text-warning" },
    { label: "Queued", value: String(queued), icon: ListOrdered, tint: "bg-info-soft text-info" },
    { label: "Completed", value: String(completed), icon: CheckCircle2, tint: "bg-success-soft text-success" },
    { label: "Failed", value: String(failed), icon: XCircle, tint: "bg-danger-soft text-danger" },
    { label: "Avg Duration", value: avgDuration, icon: Clock, tint: "bg-purple-soft text-purple" },
    { label: "Active GPU", value: `${gpuUsage}%`, icon: Cpu, tint: "bg-success-soft text-success-bright" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
      {cards.map((card) => (
        <Card key={card.label} className="shadow-[0_1px_2px_rgba(0,0,0,0.1)]">
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-[13px] font-medium text-ink-soft">{card.label}</CardTitle>
              <div className={cn("rounded p-1", card.tint)}>
                <card.icon className="size-4" aria-hidden />
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <p className={cn("text-primary", taskUi.metric)}>{card.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
