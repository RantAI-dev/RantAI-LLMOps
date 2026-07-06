"use client";

import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

type ExperimentDetailToolbarProps = {
  onDelete: () => void;
  onCreateTask: () => void;
};

/**
 * Experiment actions that Transformer Lab can actually back: start a run (opens
 * Fine-tune) and delete the experiment. Edit/Clone/Archive/status/activity were
 * removed — TL experiments are just id + name, so those were UI-only (mock).
 */
export function ExperimentDetailToolbar({ onDelete, onCreateTask }: ExperimentDetailToolbarProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <Button type="button" size="sm" className="h-8 gap-1.5" onClick={onCreateTask}>
        <Plus className="size-3.5" />
        New run
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 gap-1.5 text-danger hover:text-danger"
        onClick={onDelete}
      >
        <Trash2 className="size-3.5" />
        Hapus
      </Button>
    </div>
  );
}
