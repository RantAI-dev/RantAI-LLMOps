"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { defaultHyperparameters } from "@/modules/tasks/lib/utils";
import {
  COMPUTE_TARGETS,
  ENGINE_PLUGINS,
  TASK_PRIORITIES,
  TASK_TYPES,
  type CreateTaskInput,
  type EnginePlugin,
  type ComputeTarget,
  type Experiment,
  type TaskPriority,
  type TaskType,
} from "@/modules/tasks/types";

import { taskUi } from "@/modules/tasks/constants/task-ui";

type CreateTaskSheetProps = {
  open: boolean;
  experiments: Experiment[];
  defaultExperimentId?: string | null;
  onClose: () => void;
  onSubmit: (input: CreateTaskInput) => void;
};

export function CreateTaskSheet({
  open,
  experiments,
  defaultExperimentId,
  onClose,
  onSubmit,
}: CreateTaskSheetProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Initialized fresh per open — the parent remounts this sheet via `key`.
  const [form, setForm] = useState(() => ({
    name: "",
    experimentId:
      defaultExperimentId && experiments.some((e) => e.id === defaultExperimentId)
        ? defaultExperimentId
        : experiments[0]?.id ?? "",
    type: "Fine-tuning" as TaskType,
    description: "",
    baseModel: "meta-llama/Llama-3.1-8B-Instruct",
    dataset: "",
    engine: ENGINE_PLUGINS[0] as EnginePlugin,
    computeTarget: COMPUTE_TARGETS[1] as ComputeTarget,
    gpuRequired: 1,
    priority: "Medium" as TaskPriority,
    hyperparameters: { ...defaultHyperparameters },
  }));

  if (!open) return null;

  const canSubmit = experiments.length > 0;
  const experimentLocked =
    !!defaultExperimentId && experiments.some((e) => e.id === defaultExperimentId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.experimentId) return;
    onSubmit({
      name: form.name.trim(),
      experimentId: form.experimentId,
      type: form.type,
      description: form.description.trim(),
      baseModel: form.baseModel.trim(),
      dataset: form.dataset.trim() || "—",
      engine: form.engine,
      computeTarget: form.computeTarget,
      gpuRequired: form.gpuRequired,
      priority: form.priority,
      hyperparameters: form.hyperparameters,
    });
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
          <SheetTitle className="text-primary">Create Task</SheetTitle>
          <SheetDescription>
            Define a reusable task (recipe). Saving queues its first run — you can run it again
            anytime.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <Field label="Task Name" required>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Fine-tune WMS Assistant"
                required
              />
            </Field>
            <Field label="Experiment" required helper="Choose the experiment where this task belongs.">
              {experiments.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-surface px-3 py-2 text-[13px] text-ink-soft">
                  Create an experiment first before creating a task.
                </p>
              ) : (
                <Select
                  items={experiments.map((e) => ({ value: e.id, label: e.name }))}
                  value={form.experimentId}
                  onValueChange={(next) => next && setForm((f) => ({ ...f, experimentId: next }))}
                  disabled={experimentLocked}
                >
                  <SelectTrigger aria-label="Select experiment" className="w-full">
                    <SelectValue placeholder="Select experiment" />
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
            <div className="grid grid-cols-2 gap-3">
              <Field label="Task Type">
                <Select
                  value={form.type}
                  onValueChange={(next) => {
                    if (!next) return;
                    const type = next as TaskType;
                    const engineByType: Partial<Record<TaskType, EnginePlugin>> = {
                      "RAG Indexing": "RAG Indexer",
                      "RAG QA Generation": "RAG QA Generator",
                      "Embedding Fine-tuning": "Embedding Trainer",
                      "RAG Evaluation": "RAG Evaluator",
                    };
                    setForm((f) => ({ ...f, type, engine: engineByType[type] ?? f.engine }));
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Priority">
                <Select
                  value={form.priority}
                  onValueChange={(next) => next && setForm((f) => ({ ...f, priority: next as TaskPriority }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="Description">
              <Textarea
                className="min-h-[72px]"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="What this AI job should accomplish..."
              />
            </Field>
            <Field label="Base Model">
              <Input
                value={form.baseModel}
                onChange={(e) => setForm((f) => ({ ...f, baseModel: e.target.value }))}
              />
            </Field>
            <Field label="Dataset">
              <Input
                value={form.dataset}
                onChange={(e) => setForm((f) => ({ ...f, dataset: e.target.value }))}
                placeholder="dataset.jsonl or —"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Processing engine">
                <Select
                  value={form.engine}
                  onValueChange={(next) => next && setForm((f) => ({ ...f, engine: next as EnginePlugin }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ENGINE_PLUGINS.map((eng) => (
                      <SelectItem key={eng} value={eng}>
                        {eng}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Compute Target">
                <Select
                  value={form.computeTarget}
                  onValueChange={(next) => next && setForm((f) => ({ ...f, computeTarget: next as ComputeTarget }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPUTE_TARGETS.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <Field label="GPU Required">
              <Input
                type="number"
                min={0}
                max={8}
                value={form.gpuRequired}
                onChange={(e) => setForm((f) => ({ ...f, gpuRequired: Number(e.target.value) || 0 }))}
              />
            </Field>

            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-[14px] font-medium text-primary hover:underline"
            >
              {showAdvanced ? "Hide" : "Show"} Advanced Configuration
            </button>

            {showAdvanced ? (
              <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Epochs">
                    <Input
                      type="number"
                      min={1}
                      value={form.hyperparameters.epochs}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          hyperparameters: { ...f.hyperparameters, epochs: Number(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Batch Size">
                    <Input
                      type="number"
                      min={1}
                      value={form.hyperparameters.batchSize}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          hyperparameters: { ...f.hyperparameters, batchSize: Number(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Learning Rate">
                    <Input
                      type="number"
                      step="0.00001"
                      value={form.hyperparameters.learningRate}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          hyperparameters: { ...f.hyperparameters, learningRate: Number(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Max Token">
                    <Input
                      type="number"
                      value={form.hyperparameters.maxToken}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          hyperparameters: { ...f.hyperparameters, maxToken: Number(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                  <Field label="Temperature">
                    <Input
                      type="number"
                      step="0.1"
                      min={0}
                      max={2}
                      value={form.hyperparameters.temperature}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          hyperparameters: { ...f.hyperparameters, temperature: Number(e.target.value) },
                        }))
                      }
                    />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-[14px] text-ink">
                  <Checkbox
                    checked={form.hyperparameters.enableCheckpoint}
                    onCheckedChange={(checked) =>
                      setForm((f) => ({
                        ...f,
                        hyperparameters: { ...f.hyperparameters, enableCheckpoint: checked === true },
                      }))
                    }
                  />
                  Enable Checkpoint
                </label>
                <label className="flex items-center gap-2 text-[14px] text-ink">
                  <Checkbox
                    checked={form.hyperparameters.enableEvaluationAfterRun}
                    onCheckedChange={(checked) =>
                      setForm((f) => ({
                        ...f,
                        hyperparameters: {
                          ...f.hyperparameters,
                          enableEvaluationAfterRun: checked === true,
                        },
                      }))
                    }
                  />
                  Enable Evaluation After Run
                </label>
              </div>
            ) : null}
          </div>

          <SheetFooter className="flex-row gap-2 border-t border-border px-5 py-4">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={!canSubmit}>
              Create &amp; Queue
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
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
