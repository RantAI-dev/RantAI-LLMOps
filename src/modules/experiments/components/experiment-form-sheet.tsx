"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { experimentUi } from "@/modules/experiments/constants/experiment-ui";

type ExperimentFormSheetProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
};

/**
 * Create an experiment. Transformer Lab only stores the name (it becomes the id),
 * so that's all we collect — no fake metadata fields that wouldn't persist.
 */
export function ExperimentFormSheet({ open, onClose, onSubmit }: ExperimentFormSheetProps) {
  const [name, setName] = useState("");
  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="text-primary">Experiment baru</SheetTitle>
          <SheetDescription>
            Beri nama untuk mengelompokkan job fine-tune / eval terkait. Nama menjadi id-nya di
            Transformer Lab.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <label className="block space-y-1.5">
              <span className={experimentUi.label}>
                Nama experiment<span className="text-primary"> *</span>
              </span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="mis. rugby-sft"
                autoFocus
                required
              />
            </label>
          </div>

          <SheetFooter className="flex-row gap-2 border-t border-border px-5 py-4">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" className="flex-1" disabled={!name.trim()}>
              Buat
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
