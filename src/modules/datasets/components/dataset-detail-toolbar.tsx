"use client";

import { Archive, GitBranch, MoreHorizontal, Play, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type DatasetDetailToolbarProps = {
  onValidateAgain: () => void;
  onCreateVersion: () => void;
  onUseInExperiment: () => void;
  onArchive: () => void;
};

export function DatasetDetailToolbar({
  onValidateAgain,
  onCreateVersion,
  onUseInExperiment,
  onArchive,
}: DatasetDetailToolbarProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 border-hairline bg-white"
        onClick={onValidateAgain}
      >
        <RefreshCw className="size-3.5" />
        Validate Again
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 border-hairline bg-white"
        onClick={onCreateVersion}
      >
        <GitBranch className="size-3.5" />
        New Version
      </Button>
      <Button type="button" size="sm" className="h-8 gap-1.5" onClick={onUseInExperiment}>
        <Play className="size-3.5" />
        Use in Experiment
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-8 border-hairline bg-white px-0"
              aria-label="More actions"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="min-w-[148px]">
          <DropdownMenuItem onClick={onArchive}>
            <Archive className="size-3.5" /> Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
