import { CheckCircle2, FlaskConical, Layers, ListTodo, PlayCircle, XCircle } from "lucide-react";

import { SummaryCardGrid, type SummaryCard } from "@/components/ui/summary-card-grid";
import { deriveExperimentStatus } from "@/modules/experiments/lib/utils";
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

  const cards: SummaryCard[] = [
    { label: "Total Experiments", value: String(totalExperiments), icon: Layers, iconWrapClassName: "bg-primary-soft text-primary" },
    { label: "Active", value: String(activeExperiments), icon: FlaskConical, iconWrapClassName: "bg-info-soft text-info" },
    { label: "Running", value: String(runningExperiments), icon: PlayCircle, iconWrapClassName: "bg-warning-soft text-warning" },
    { label: "Completed", value: String(completedExperiments), icon: CheckCircle2, iconWrapClassName: "bg-success-soft text-success" },
    { label: "Failed", value: String(failedExperiments), icon: XCircle, iconWrapClassName: "bg-danger-soft text-danger" },
    { label: "Related Tasks", value: String(totalRelatedTasks), icon: ListTodo, iconWrapClassName: "bg-purple-soft text-purple" },
  ];

  return (
    <SummaryCardGrid
      cards={cards}
      columns={6}
      cardClassName="shadow-[0_1px_2px_rgba(0,0,0,0.1)]"
      headerClassName="pb-1"
      titleClassName="text-[13px] font-medium text-ink-soft"
      contentClassName="pt-0"
      metricClassName={experimentUi.metric}
    />
  );
}
