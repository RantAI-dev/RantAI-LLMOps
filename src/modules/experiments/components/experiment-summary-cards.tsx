import { CheckCircle2, FlaskConical, Layers, ListTodo, PlayCircle, XCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { deriveExperimentStatus } from "@/modules/experiments/lib/utils";
import { cn } from "@/lib/utils";
import type { Experiment } from "@/modules/experiments/types";
import type { AITask } from "@/modules/tasks/types";

import { experimentUi } from "../constants/experiment-ui";

export function ExperimentSummaryCards({
  experiments,
  tasks,
}: {
  experiments: Experiment[];
  tasks: AITask[];
}) {
  const totalExperiments = experiments.length;
  const activeExperiments = experiments.filter(
    (e) => deriveExperimentStatus(e, tasks) === "Active"
  ).length;
  const runningExperiments = experiments.filter(
    (e) => deriveExperimentStatus(e, tasks) === "Running"
  ).length;
  const completedExperiments = experiments.filter(
    (e) => deriveExperimentStatus(e, tasks) === "Completed"
  ).length;
  const failedExperiments = experiments.filter(
    (e) => deriveExperimentStatus(e, tasks) === "Failed"
  ).length;
  const totalRelatedTasks = tasks.length;

  const cards = [
    { label: "Total Experiments", value: String(totalExperiments), icon: Layers, tint: "bg-primary-soft text-primary" },
    { label: "Active", value: String(activeExperiments), icon: FlaskConical, tint: "bg-info-soft text-info" },
    { label: "Running", value: String(runningExperiments), icon: PlayCircle, tint: "bg-warning-soft text-warning" },
    { label: "Completed", value: String(completedExperiments), icon: CheckCircle2, tint: "bg-success-soft text-success" },
    { label: "Failed", value: String(failedExperiments), icon: XCircle, tint: "bg-danger-soft text-danger" },
    { label: "Related Tasks", value: String(totalRelatedTasks), icon: ListTodo, tint: "bg-purple-soft text-purple" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
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
            <p className={cn("text-primary", experimentUi.metric)}>{card.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
