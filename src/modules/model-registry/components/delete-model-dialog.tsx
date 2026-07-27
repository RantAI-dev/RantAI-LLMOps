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

type DeleteModelDialogProps = {
  model: RegistryModel | null;
  onClose: () => void;
  onConfirm: () => void;
};

export function DeleteModelDialog({ model, onClose, onConfirm }: DeleteModelDialogProps) {
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
          <DialogTitle className="text-primary">Delete model?</DialogTitle>
          <DialogDescription>
            <strong className="text-ink">{model.modelName}</strong> will be permanently removed from
            Ollama, along with its GGUF file. This action cannot be undone — you can download or
            export the model again later if needed.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
