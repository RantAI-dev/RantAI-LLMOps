"use client";

import { useState } from "react";

import { LoadingState } from "@/components/ui/loading-state";
import { cn } from "@/lib/utils";
import { DatasetForm } from "@/modules/finetune/components/dataset-form";
import { FinetuneForm } from "@/modules/finetune/components/finetune-form";
import { JobList } from "@/modules/finetune/components/job-list";
import { SweepPanel } from "@/modules/finetune/components/sweep-panel";
import { useFinetune } from "@/modules/finetune/hooks/use-finetune";

type Tab = "single" | "sweep";

/** Fine-tune workspace: configure + start a LoRA run, then watch jobs live. */
export function FinetunePage() {
  const {
    options,
    jobs,
    loading,
    submitting,
    error,
    submit,
    createDataset,
    deleteDataset,
    stopJob,
    deleteJob,
  } = useFinetune();
  const [tab, setTab] = useState<Tab>("single");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-primary">Fine-tune</h1>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          Latih adaptor LoRA dari base model + dataset-mu, langsung di Transformer Lab.
          Adaptor yang jadi bisa dipakai di tab <strong>Fine-tuned</strong> pada model picker.
        </p>
      </div>

      {loading ? (
        <LoadingState label="Loading fine-tune workspace…" />
      ) : (
        <>
          <div className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1">
            {(
              [
                ["single", "Single run"],
                ["sweep", "Sweep"],
              ] as const
            ).map(([id, lbl]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-[13px] font-medium transition",
                  tab === id ? "bg-surface text-primary shadow-sm" : "text-ink-soft hover:text-ink"
                )}
              >
                {lbl}
              </button>
            ))}
          </div>

          {tab === "single" ? (
            <>
              <FinetuneForm
                options={options}
                loading={loading}
                submitting={submitting}
                error={error}
                onSubmit={submit}
                onDeleteDataset={deleteDataset}
              />

              <DatasetForm onCreate={createDataset} />
            </>
          ) : (
            <SweepPanel options={options} />
          )}

          <div>
            <h2 className="mb-2 text-sm font-semibold text-primary">Training jobs</h2>
            <JobList jobs={jobs} onStop={stopJob} onDelete={deleteJob} />
          </div>
        </>
      )}
    </div>
  );
}
