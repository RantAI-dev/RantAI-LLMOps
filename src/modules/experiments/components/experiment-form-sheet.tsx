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
import { Textarea } from "@/components/ui/textarea";
import { experimentUi } from "@/modules/experiments/constants/experiment-ui";
import {
  BASE_MODELS,
  DATASETS,
  EXPERIMENT_STATUSES,
  SUCCESS_METRICS,
  type CreateExperimentInput,
  type Experiment,
} from "@/modules/experiments/types";

type ExperimentFormSheetProps = {
  open: boolean;
  mode: "create" | "edit";
  experiment?: Experiment | null;
  onClose: () => void;
  onSubmit: (input: CreateExperimentInput) => void;
};

const defaultForm: CreateExperimentInput = {
  name: "",
  description: "",
  objective: "",
  owner: "Admin-NQR",
  baseModel: BASE_MODELS[0],
  dataset: DATASETS[0],
  successMetric: SUCCESS_METRICS[0],
  evaluationThreshold: "Accuracy must be above 85%",
  status: "Draft",
  tags: [],
  notes: "",
};

export function ExperimentFormSheet({
  open,
  mode,
  experiment,
  onClose,
  onSubmit,
}: ExperimentFormSheetProps) {
  // Initialized fresh per open — the parent remounts this sheet via `key`.
  const [form, setForm] = useState<CreateExperimentInput>(() =>
    mode === "edit" && experiment
      ? {
          name: experiment.name,
          description: experiment.description,
          objective: experiment.objective,
          owner: experiment.owner,
          baseModel: experiment.baseModel,
          dataset: experiment.dataset,
          successMetric: experiment.successMetric,
          evaluationThreshold: experiment.evaluationThreshold,
          status: experiment.status,
          tags: [...experiment.tags],
          notes: experiment.notes,
        }
      : defaultForm
  );
  const [tagsInput, setTagsInput] = useState(() =>
    mode === "edit" && experiment ? experiment.tags.join(", ") : ""
  );

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const tags = tagsInput
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    onSubmit({ ...form, name: form.name.trim(), tags });
  };

  const title = mode === "create" ? "Create Experiment" : "Edit Experiment";

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle className="text-primary">{title}</SheetTitle>
          <SheetDescription>
            {mode === "create"
              ? "Define a new LLM experiment to group related AI tasks."
              : "Update experiment configuration and metadata."}
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <Field label="Experiment Name" required>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. WMS Assistant Alpha"
                required
              />
            </Field>
            <Field label="Description">
              <Textarea
                className="min-h-[72px]"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What is this experiment about?"
              />
            </Field>
            <Field label="Objective">
              <Textarea
                className="min-h-[60px]"
                value={form.objective}
                onChange={(e) => setForm((f) => ({ ...f, objective: e.target.value }))}
                placeholder="What outcome are you measuring?"
              />
            </Field>
            <Field label="Owner">
              <Input
                value={form.owner}
                onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))}
              />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Base Model">
                <FormSelect
                  value={form.baseModel}
                  onChange={(v) => setForm((f) => ({ ...f, baseModel: v }))}
                  options={BASE_MODELS}
                />
              </Field>
              <Field label="Dataset">
                <FormSelect
                  value={form.dataset}
                  onChange={(v) => setForm((f) => ({ ...f, dataset: v }))}
                  options={DATASETS}
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Success Metric">
                <FormSelect
                  value={form.successMetric}
                  onChange={(v) => setForm((f) => ({ ...f, successMetric: v }))}
                  options={SUCCESS_METRICS}
                />
              </Field>
              <Field label="Status">
                <FormSelect
                  value={form.status}
                  onChange={(v) => setForm((f) => ({ ...f, status: v as CreateExperimentInput["status"] }))}
                  options={EXPERIMENT_STATUSES}
                />
              </Field>
            </div>
            <Field label="Evaluation Threshold">
              <Input
                value={form.evaluationThreshold}
                onChange={(e) => setForm((f) => ({ ...f, evaluationThreshold: e.target.value }))}
                placeholder="e.g. Accuracy must be above 85%"
              />
            </Field>
            <Field label="Tags" helper="Comma-separated">
              <Input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="WMS, Fine-tuning"
              />
            </Field>
            <Field label="Notes">
              <Textarea
                className="min-h-[72px]"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </Field>
          </div>

          <SheetFooter className="flex-row gap-2 border-t border-border px-5 py-4">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1">
              {mode === "create" ? "Create Experiment" : "Save Changes"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function FormSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
}) {
  return (
    <Select value={value} onValueChange={(next) => next != null && onChange(next)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt} value={opt}>
            {opt}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
      <span className={experimentUi.label}>
        {label}
        {required ? <span className="text-primary"> *</span> : null}
      </span>
      {helper ? <p className="text-xs text-ink-soft">{helper}</p> : null}
      {children}
    </label>
  );
}
