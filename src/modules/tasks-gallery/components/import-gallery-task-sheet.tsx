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
import { defaultHyperparameters } from "@/modules/tasks/lib/utils";
import type { CreateTaskInput, Experiment } from "@/modules/tasks/types";
import {
  categoryToTaskType,
  frameworkToEngine,
  recommendedGpuCount,
} from "@/modules/tasks-gallery/lib/gallery-mapping";
import type { GalleryTask } from "@/modules/tasks-gallery/types";

type ImportGalleryTaskSheetProps = {
  task: GalleryTask | null;
  experiments: Experiment[];
  onClose: () => void;
  onImport: (input: CreateTaskInput) => string | undefined;
};

export function ImportGalleryTaskSheet({
  task,
  experiments,
  onClose,
  onImport,
}: ImportGalleryTaskSheetProps) {
  // Initialized fresh per task — the page remounts this sheet via `key`.
  const [experimentId, setExperimentId] = useState(experiments[0]?.id ?? "");
  const [name, setName] = useState(task?.title ?? "");
  const [baseModel, setBaseModel] = useState("");
  const [dataset, setDataset] = useState("");

  if (!task) return null;

  const engine = frameworkToEngine(task);
  const type = categoryToTaskType(task);
  const gpuRequired = recommendedGpuCount(task);
  const canSubmit = experiments.length > 0 && name.trim() && experimentId;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onImport({
      name: name.trim(),
      experimentId,
      type,
      description: task.description,
      baseModel: baseModel.trim() || "—",
      dataset: dataset.trim() || "—",
      engine,
      computeTarget: "Local GPU",
      gpuRequired,
      priority: "Medium",
      hyperparameters: { ...defaultHyperparameters },
    });
    onClose();
  };

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="text-primary">Import “{task.title}”</SheetTitle>
          <SheetDescription>
            Creates a Task (recipe) in an experiment. Maps to TL gallery import:{" "}
            <code className="text-[12px]">{task.githubRepoDir}</code>
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="flex flex-wrap gap-1.5">
              <Chip label={`Engine: ${engine}`} />
              <Chip label={`Type: ${type}`} />
              <Chip label={`GPUs: ${gpuRequired}`} />
            </div>

            <Field label="Experiment" required helper="The experiment this imported task belongs to.">
              {experiments.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-surface px-3 py-2 text-[13px] text-ink-soft">
                  Create an experiment first before importing a task.
                </p>
              ) : (
                <Select
                  items={experiments.map((e) => ({ value: e.id, label: e.name }))}
                  value={experimentId}
                  onValueChange={(next) => next && setExperimentId(next)}
                >
                  <SelectTrigger aria-label="Select experiment" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {experiments.map((experiment) => (
                      <SelectItem key={experiment.id} value={experiment.id}>
                        {experiment.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <Field label="Task Name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>

            <Field label="Base Model" helper="Optional — set the model this recipe should fine-tune.">
              <Input
                value={baseModel}
                onChange={(e) => setBaseModel(e.target.value)}
                placeholder="e.g. meta-llama/Llama-3.1-8B-Instruct"
              />
            </Field>

            <Field label="Dataset" helper="Optional — set the dataset for this recipe.">
              <Input
                value={dataset}
                onChange={(e) => setDataset(e.target.value)}
                placeholder="dataset.jsonl"
              />
            </Field>
          </div>

          <SheetFooter className="flex-row gap-2 border-t border-border px-5 py-4">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={!canSubmit}>
              Import &amp; Queue Run
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary-strong">
      {label}
    </span>
  );
}

function Field({
  label,
  required,
  helper,
  children,
}: {
  label: string;
  required?: boolean;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className={taskUi.label}>
        {label}
        {required ? " *" : ""}
      </span>
      {helper ? <p className="text-[12px] leading-4 text-ink-soft">{helper}</p> : null}
      {children}
    </label>
  );
}
