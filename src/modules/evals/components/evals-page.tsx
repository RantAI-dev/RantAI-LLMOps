"use client";

import { useState } from "react";

import { LoadingState } from "@/components/ui/loading-state";
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
  const { options, jobs, loading, submitting, error, submit, comparing, compareProgress, submitCompare } =
    useEvals();
  const [tab, setTab] = useState<Tab>("single");

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-primary">Evals</h1>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          Ukur kualitas model pakai benchmark standar (EleutherAI LM-Eval-Harness), langsung di
          Transformer Lab. Bandingkan base vs hasil <strong>fine-tune</strong> buat lihat efeknya.
          Tab <strong>Grounding</strong> mengukur hal yang berbeda: apakah model menjawab hanya dari
          materi yang diberikan, menolak saat jawabannya tidak ada, dan menyebut sumbernya.
        </p>
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
                ["retention", "Retensi"],
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
              <div>
                <h2 className="mb-2 text-sm font-semibold text-primary">Riwayat run</h2>
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
            <RetentionView options={options} jobs={jobs} />
          ) : (
            <GroundingEval />
          )}
        </>
      )}
    </div>
  );
}
