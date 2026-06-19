"use client";

import { LoadingState } from "@/components/ui/loading-state";
import { EvalForm } from "@/modules/evals/components/eval-form";
import { EvalJobList } from "@/modules/evals/components/eval-job-list";
import { useEvals } from "@/modules/evals/hooks/use-evals";

/** Evals workspace: run a benchmark on a model and read the accuracy. */
export function EvalsPage() {
  const { options, jobs, loading, submitting, error, submit } = useEvals();

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-primary">Evals</h1>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          Ukur kualitas model pakai benchmark standar (EleutherAI LM-Eval-Harness), langsung di
          Transformer Lab. Bandingkan base vs hasil <strong>fine-tune</strong> buat lihat efeknya.
        </p>
      </div>

      {loading ? (
        <LoadingState label="Loading evals workspace…" />
      ) : (
        <>
          <EvalForm options={options} submitting={submitting} error={error} onSubmit={submit} />
          <div>
            <h2 className="mb-2 text-sm font-semibold text-primary">Results</h2>
            <EvalJobList jobs={jobs} />
          </div>
        </>
      )}
    </div>
  );
}
