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
import type { RegistryModel } from "@/modules/model-registry/types";

type ArchiveModelDialogProps = {
  model: RegistryModel | null;
  onClose: () => void;
  onConfirm: () => void;
};

export function ArchiveModelDialog({ model, onClose, onConfirm }: ArchiveModelDialogProps) {
  if (!model) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-primary">Archive model?</DialogTitle>
          <DialogDescription>
            <strong className="text-ink">{model.modelName}</strong> will be moved to archived
            status and hidden from the default registry view.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Archive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
