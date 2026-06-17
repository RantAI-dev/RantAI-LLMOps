"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { fieldClassName, modelRegistryUi } from "@/modules/model-registry/constants/model-registry-ui";
import { MODEL_OWNERS, MODEL_TASKS } from "@/modules/model-registry/types";

const FORMATS = ["LoRA Adapter", "Full Weights", "GGUF", "Safetensors"] as const;

type RegisterLocalSheetProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { modelName: string; task: (typeof MODEL_TASKS)[number]; format: string; owner: string }) => string;
  onViewModel: (id: string) => void;
};

export function RegisterLocalSheet({ open, onClose, onSubmit, onViewModel }: RegisterLocalSheetProps) {
  const [modelName, setModelName] = useState("");
  const [task, setTask] = useState<(typeof MODEL_TASKS)[number]>("Chat");
  const [format, setFormat] = useState<string>("LoRA Adapter");
  const [owner, setOwner] = useState<string>(MODEL_OWNERS[0]);
  // Fresh state per open — the parent remounts this sheet via `key`.

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelName.trim()) return;
    const id = onSubmit({ modelName: modelName.trim(), task, format, owner });
    onClose();
    onViewModel(id);
  };

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle className={modelRegistryUi.section + " text-primary"}>Register Local Model</SheetTitle>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <Field label="Model Name">
              <Input
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="e.g. Internal Invoice Assistant v3"
                className={fieldClassName}
                required
              />
            </Field>
            <Field label="Task">
              <Select value={task} onValueChange={(next) => next && setTask(next as (typeof MODEL_TASKS)[number])}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_TASKS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Format">
              <Select value={format} onValueChange={(next) => next && setFormat(next)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMATS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Model Owner">
              <Select value={owner} onValueChange={(next) => next && setOwner(next)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODEL_OWNERS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <SheetFooter className="flex-row gap-2 border-t border-border px-4 py-4">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1">
              Register Model
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className={modelRegistryUi.label}>{label}</span>
      {children}
    </label>
  );
}
