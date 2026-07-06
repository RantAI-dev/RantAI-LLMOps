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
          <DialogTitle className="text-primary">Hapus model?</DialogTitle>
          <DialogDescription>
            <strong className="text-ink">{model.modelName}</strong> akan dihapus permanen dari
            Ollama (beserta file GGUF-nya). Tindakan ini tidak bisa dibatalkan — model bisa
            di-download / di-export ulang nanti kalau diperlukan.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Batal
          </Button>
          <Button type="button" variant="destructive" onClick={onConfirm}>
            Hapus
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
