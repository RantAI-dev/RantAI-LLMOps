"use client";

import { useState } from "react";

import { LoadingState } from "@/components/ui/loading-state";
import { InfoTip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { EvalCompare } from "@/modules/evals/components/eval-compare";
import { EvalForm } from "@/modules/evals/components/eval-form";
import { EvalJobList } from "@/modules/evals/components/eval-job-list";
import { GroundingEval } from "@/modules/evals/components/grounding-eval";
import { RetentionView } from "@/modules/evals/components/retention-view";
import { useEvals } from "@/modules/evals/hooks/use-evals";

type Tab = "single" | "compare" | "retention" | "grounding";

/** Evals workspace: run a benchmark on a model and read the accuracy. */
export function EvalsPage() {
  const { options, jobs, loading, submitting, preparing, error, submit, comparing, compareProgress, submitCompare } =
    useEvals();
  const [tab, setTab] = useState<Tab>("single");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div className="flex items-center gap-1.5">
        <h1 className="text-lg font-semibold text-primary">Evals</h1>
        <InfoTip label="About evals">
          Measure model quality with standard benchmarks (EleutherAI LM-Eval-Harness), directly in
          Transformer Lab. Compare the base against your <strong>fine-tune</strong> to see the effect.
          The <strong>Grounding</strong> tab measures something different: whether the model answers
          only from the material provided, refuses when the answer is not there, and cites its source.
        </InfoTip>
      </div>

      {loading ? (
        <LoadingState label="Loading evals workspace…" />
      ) : (
        <>
          <div className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1">
            {(
              [
                ["single", "Single run"],
                ["compare", "Compare"],
                ["retention", "Retention"],
                ["grounding", "Grounding"],
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

          {/* Single run: kick off a test, then the run log — each run its own
              rich card. Compare: its own scoreboard. Grounding: self-contained.
              The run history lives only under Single run; a run IS a single
              model on a single benchmark, which is what its history records. */}
          {tab === "single" ? (
            <>
              <EvalForm options={options} submitting={submitting} error={error} onSubmit={submit} />
              {preparing ? (
                <div className="rounded-lg border border-primary/30 bg-primary-soft/50 px-3 py-2 text-[12px] text-primary">
                  Preparing the model and queuing the eval… For a fine-tune, the adapter is merged
                  into the base model first (this can take a few minutes for large models) — the job
                  will appear in the history below.
                </div>
              ) : null}
              <div>
                <h2 className="mb-2 text-sm font-semibold text-primary">Run history</h2>
                <EvalJobList jobs={jobs} />
              </div>
            </>
          ) : tab === "compare" ? (
            <EvalCompare
              options={options}
              jobs={jobs}
              comparing={comparing}
              compareProgress={compareProgress}
              onCompare={submitCompare}
            />
          ) : tab === "retention" ? (
            <RetentionView
              options={options}
              jobs={jobs}
              // Jump to Single run on launch so the new base eval's progress is
              // visible (Retensi only shows a quiet spinner until the score lands).
              onRunBase={async (body) => {
                const ok = await submit(body);
                if (ok) setTab("single");
                return ok;
              }}
              submitting={submitting}
            />
          ) : (
            <GroundingEval />
          )}
        </>
      )}
    </div>
  );
}
