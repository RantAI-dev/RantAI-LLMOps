"use client";

import { Cpu, Database, MoreHorizontal, Trash2, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import {
  deriveExperimentStatus,
  formatDateTime,
  getExperimentTaskStats,
} from "@/modules/experiments/lib/utils";
import { cn } from "@/lib/utils";
import type { Experiment } from "@/modules/experiments/types";
import type { AITask } from "@/modules/tasks/types";

import { ExperimentStatusBadge } from "./experiment-status-badge";

type ExperimentCardProps = {
  experiment: Experiment;
  tasks: AITask[];
  onView: () => void;
  onDelete: () => void;
};

export function ExperimentCard({ experiment, tasks, onView, onDelete }: ExperimentCardProps) {
  const stats = getExperimentTaskStats(tasks, experiment.id);
  const effectiveStatus = deriveExperimentStatus(experiment, tasks);
  const visibleTags = experiment.tags.slice(0, 3);
  const hiddenTagCount = experiment.tags.length - visibleTags.length;

  return (
    <Card
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onView();
        }
      }}
      className={cn(
        "group relative flex cursor-pointer flex-col overflow-hidden",
        "border-[#e8e8e8] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06)]",
        "transition-[border-color,box-shadow,background-color] duration-200",
        "hover:border-primary/25 hover:bg-[#fffcfa] hover:shadow-[0_4px_12px_rgba(255,80,1,0.08)]"
      )}
      onClick={onView}
    >
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <ExperimentStatusBadge status={effectiveStatus} />
          <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    className="size-7 text-ink-soft opacity-0 transition-opacity hover:bg-primary-soft hover:text-primary group-hover:opacity-100 group-focus-within:opacity-100 data-[popup-open]:opacity-100"
                    aria-label="Experiment actions"
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                }
              />
              <DropdownMenuContent align="end" className="min-w-[148px]">
                <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                  <Trash2 className="size-3.5" /> Hapus
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="min-w-0 space-y-1">
          <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-primary transition-colors group-hover:text-[#e64800]">
            {experiment.name}
          </h3>
          <p className="line-clamp-2 text-[13px] leading-5 text-ink-soft">{experiment.description}</p>
        </div>

        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
          <MetaItem icon={User} label={experiment.owner} />
          <MetaItem icon={Cpu} label={experiment.baseModel} />
          <MetaItem icon={Database} label={experiment.dataset} className="min-w-0 max-w-full basis-full sm:basis-auto" />
        </ul>

        {experiment.tags.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1">
            {visibleTags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-primary-soft/80 px-2 py-0.5 text-[11px] font-medium text-primary-strong"
              >
                {tag}
              </span>
            ))}
            {hiddenTagCount > 0 ? (
              <span className="text-[11px] text-ink-faint">+{hiddenTagCount}</span>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-4 divide-x divide-[#ebebeb] rounded-lg bg-[#f8f8f8] px-1 py-2.5">
          <MetricCell label="Tasks" value={stats.totalTasks} />
          <MetricCell label="Running" value={stats.runningTasks} highlight={stats.runningTasks > 0} />
          <MetricCell label="Done" value={stats.completedTasks} />
          <MetricCell label="Failed" value={stats.failedTasks} warn={stats.failedTasks > 0} />
        </div>
      </div>

      <footer className="border-t border-surface-3 bg-surface/80 px-4 py-3">
        <div className="mb-2 flex items-center justify-between gap-2 text-xs">
          <span className="text-ink-soft">Overall progress</span>
          <span className="font-medium tabular-nums text-ink">{stats.overallProgress}%</span>
        </div>
        <Progress value={stats.overallProgress} className="h-1.5" />
        <div className="mt-2.5 flex items-center justify-between gap-2 text-[11px] text-ink-faint">
          <span>
            Best score{" "}
            <span className="font-medium tabular-nums text-ink-soft">
              {experiment.bestScore > 0 ? `${experiment.bestScore}%` : "—"}
            </span>
          </span>
          <span className="truncate">{formatDateTime(experiment.updatedAt)}</span>
        </div>
      </footer>
    </Card>
  );
}

function MetaItem({
  icon: Icon,
  label,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  className?: string;
}) {
  return (
    <li className={cn("flex min-w-0 max-w-full items-center gap-1.5", className)}>
      <Icon className="size-3 shrink-0 text-primary/70" aria-hidden />
      <span className="truncate">{label}</span>
    </li>
  );
}

function MetricCell({
  label,
  value,
  highlight,
  warn,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  warn?: boolean;
}) {
  return (
    <div className="px-2 text-center">
      <p className="text-[10px] font-medium tracking-wide text-ink-faint uppercase">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-[15px] font-semibold tabular-nums leading-none",
          warn ? "text-danger" : highlight ? "text-warning" : "text-primary"
        )}
      >
        {value}
      </p>
    </div>
  );
}

