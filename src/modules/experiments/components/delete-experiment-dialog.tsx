"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Experiment } from "@/modules/experiments/types";
import type { AITask } from "@/modules/tasks/types";

type DeleteExperimentDialogProps = {
  experiment: Experiment | null;
  tasks: AITask[];
  onClose: () => void;
  onConfirm: () => void;
};

export function DeleteExperimentDialog({
  experiment,
  tasks,
  onClose,
  onConfirm,
}: DeleteExperimentDialogProps) {
  if (!experiment) return null;

  const relatedCount = tasks.filter((t) => t.experimentId === experiment.id).length;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-primary">Delete experiment?</DialogTitle>
          <DialogDescription>
            You are about to delete <strong className="text-ink">{experiment.name}</strong>.
            {relatedCount > 0
              ? ` This experiment has ${relatedCount} related task${relatedCount === 1 ? "" : "s"}. Deleting it may unlink related tasks.`
              : " This action cannot be undone."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" className="flex-1" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
