"use client";

import { GitCompare, MoreHorizontal, Play, Sparkles, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RegistryModel } from "@/modules/model-registry/types";

type ModelDetailToolbarProps = {
  model: RegistryModel;
  onTest: () => void;
  onFineTune: () => void;
  onCompare: () => void;
  onDelete: () => void;
};

export function ModelDetailToolbar({
  onTest,
  onFineTune,
  onCompare,
  onDelete,
}: ModelDetailToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={onTest}>
        <Play className="size-4" />
        Test in Playground
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={onFineTune}>
        <Sparkles className="size-4" />
        Fine-tune
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button type="button" variant="ghost" size="sm" aria-label="More actions">
              <MoreHorizontal className="size-4" />
            </Button>
          }
        />
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={onCompare}>
            <GitCompare className="size-3.5" /> Compare
          </DropdownMenuItem>
          <DropdownMenuItem className="text-destructive" onClick={onDelete}>
            <Trash2 className="size-3.5" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
