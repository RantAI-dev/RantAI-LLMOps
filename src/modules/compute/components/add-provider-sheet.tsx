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
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { taskUi } from "@/modules/tasks/constants/task-ui";
import { PROVIDER_TYPES, type AddProviderInput, type ProviderType } from "@/modules/compute/types";

type AddProviderSheetProps = {
  open: boolean;
  onClose: () => void;
  onAdd: (input: AddProviderInput) => void;
};

export function AddProviderSheet({ open, onClose, onAdd }: AddProviderSheetProps) {
  const [type, setType] = useState<ProviderType>("RunPod");
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAdd({ type, name: name.trim(), detail: detail.trim() });
    setName("");
    setDetail("");
    onClose();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="text-primary">Add compute provider</SheetTitle>
          <SheetDescription>
            Tells Transformer Lab where to run training &amp; inference jobs.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <label className="block space-y-1.5">
              <span className={taskUi.label}>Provider type</span>
              <Select value={type} onValueChange={(next) => next && setType(next as ProviderType)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="block space-y-1.5">
              <span className={taskUi.label}>Name *</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. RunPod (serverless)"
                required
              />
            </label>
            <label className="block space-y-1.5">
              <span className={taskUi.label}>Notes</span>
              <Input
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                placeholder="Region, credentials profile, etc."
              />
            </label>
            <p className="rounded-md border border-warning-border bg-warning-soft-3 px-3 py-2 text-[12px] text-warning-strong">
              Credentials &amp; cluster config are set per provider after adding (TL{" "}
              <code className="text-[11px]">lab provider add</code> / web UI).
            </p>
          </div>

          <SheetFooter className="flex-row gap-2 border-t border-border px-5 py-4">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={!name.trim()}>
              Add provider
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
