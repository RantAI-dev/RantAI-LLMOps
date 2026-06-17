"use client";

import {
  Archive,
  Copy,
  History,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EXPERIMENT_STATUSES, type Experiment } from "@/modules/experiments/types";

type ExperimentDetailToolbarProps = {
  experiment: Experiment;
  activityCount: number;
  onActivity: () => void;
  onEdit: () => void;
  onClone: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onChangeStatus: (status: Experiment["status"]) => void;
  onCreateTask: () => void;
};

export function ExperimentDetailToolbar({
  experiment,
  activityCount,
  onActivity,
  onEdit,
  onClone,
  onArchive,
  onDelete,
  onChangeStatus,
  onCreateTask,
}: ExperimentDetailToolbarProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5" onClick={onActivity}>
        <History className="size-3.5" />
        Activity
        {activityCount > 0 ? (
          <span className="rounded-full bg-primary-soft px-1.5 text-[11px] font-semibold tabular-nums text-primary">
            {activityCount}
          </span>
        ) : null}
      </Button>
      <Button type="button" size="sm" className="h-8 gap-1.5" onClick={onCreateTask}>
        <Plus className="size-3.5" />
        Create Task
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button type="button" variant="outline" size="sm" className="h-8 w-8 px-0" aria-label="More actions">
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-[180px]">
          <DropdownMenuItem onClick={onEdit}>
            <Pencil className="size-3.5" /> Edit
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onClone}>
            <Copy className="size-3.5" /> Clone
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onArchive}>
            <Archive className="size-3.5" /> Archive
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Status: {experiment.status}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={experiment.status}
                onValueChange={(next) => next && onChangeStatus(next as Experiment["status"])}
              >
                {EXPERIMENT_STATUSES.map((s) => (
                  <DropdownMenuRadioItem key={s} value={s}>
                    {s}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={onDelete}>
            <Trash2 className="size-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
