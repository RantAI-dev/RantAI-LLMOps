"use client";

import { FlaskConical, Plus, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { MockBanner } from "@/components/ui/mock-banner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MOCK_RAG_EVAL_RUNS } from "@/modules/datasets/data/rag-mock-data";
import { datasetUi, panelClassName } from "@/modules/datasets/constants/dataset-ui";
import { useLlmOps } from "@/modules/llm-ops/context/llm-ops-provider";
import type { RagEvalMetric } from "@/modules/datasets/types";
import { cn } from "@/lib/utils";

export function EvalsRagPage() {
  const { openCreateTask } = useLlmOps();

  return (
    <div className="min-w-0 w-full space-y-4">
      <div className="flex flex-col gap-4 border-b border-hairline pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className={cn("text-primary", datasetUi.title)}>Evals</h1>
          <p className={cn("mt-1 max-w-2xl", datasetUi.subheading)}>
            Measure how well your knowledge bases retrieve the right information and produce
            trustworthy answers.
          </p>
        </div>
        <Button type="button" onClick={() => openCreateTask()}>
          <Plus className="size-4" />
          Run evaluation
        </Button>
      </div>

      <MockBanner>
        RAG evaluation (Contextual Precision / Answer Relevancy / Faithfulness) belum ada di
        backend Transformer Lab — semua skor dan run di bawah masih contoh (mock).
      </MockBanner>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          ["Contextual Precision", "How often the right passages are retrieved", "0.89"],
          ["Answer Relevancy", "How well answers address the question", "0.85"],
          ["Faithfulness", "How closely answers follow source material", "0.92"],
        ].map(([title, desc, score]) => (
          <div key={title} className={cn(panelClassName, "p-4")}>
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-ink">{title}</p>
              <FlaskConical className="size-4 text-primary/70" />
            </div>
            <p className="mt-1 text-[24px] font-semibold tabular-nums text-primary">{score}</p>
            <p className="mt-1 text-xs text-ink-soft">{desc}</p>
            <p className="mt-2 flex items-center gap-1 text-[11px] text-success-bright">
              <TrendingUp className="size-3" />
              Improvement after embedding fine-tune
            </p>
          </div>
        ))}
      </div>

      <section className="space-y-3">
        <h2 className="text-[16px] font-semibold text-primary">Recent runs</h2>
        {MOCK_RAG_EVAL_RUNS.map((run) => (
          <div key={run.id} className={cn(panelClassName, "p-4")}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-ink">{run.name}</p>
                <p className="mt-0.5 text-xs text-ink-soft">
                  {run.knowledgeBaseName} · {run.embeddingModel} · {run.status}
                </p>
              </div>
              {run.taskId ? (
                <span className="rounded bg-surface-2 px-2 py-0.5 text-[11px] text-ink-soft">
                  Linked task
                </span>
              ) : null}
            </div>
            <MetricsComparison metrics={run.metrics} />
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-[16px] font-semibold text-primary">Recommended workflow</h2>
        <div className="overflow-hidden rounded-lg border border-hairline bg-white">
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow className="bg-surface">
                <TableHead>Step</TableHead>
                <TableHead>What to do</TableHead>
                <TableHead>Where</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ["1", "Add source documents", "Documents"],
                ["2", "Build an evaluation Q&A set", "Tasks → RAG QA Generation"],
                ["3", "Improve retrieval with a tuned embedding model", "Tasks → Embedding Fine-tuning"],
                ["4", "Test answers with real questions", "Interact"],
                ["5", "Score retrieval and answer quality", "Evals or Tasks → RAG Evaluation"],
              ].map(([step, action, where]) => (
                <TableRow key={step}>
                  <TableCell className="font-medium">{step}</TableCell>
                  <TableCell className="text-ink">{action}</TableCell>
                  <TableCell className="text-ink-soft">{where}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function MetricsComparison({ metrics }: { metrics: RagEvalMetric[] }) {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      {metrics.map((m) => {
        const delta = m.fineTuned - m.baseline;
        const improved = delta > 0;
        return (
          <div key={m.id} className="rounded-md border border-border bg-white p-3">
            <p className="text-xs font-medium text-ink">{m.name}</p>
            <div className="mt-2 flex items-end gap-3">
              <div>
                <p className="text-[10px] text-ink-faint">Before tuning</p>
                <p className="text-[18px] font-semibold tabular-nums">{m.baseline.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-[10px] text-ink-faint">After tuning</p>
                <p className="text-[18px] font-semibold tabular-nums text-primary">
                  {m.fineTuned.toFixed(2)}
                </p>
              </div>
              {delta !== 0 && (
                <span
                  className={cn(
                    "mb-1 text-[11px] font-medium",
                    improved ? "text-success-bright" : "text-danger"
                  )}
                >
                  {improved ? "+" : ""}
                  {delta.toFixed(2)}
                </span>
              )}
            </div>
            <Progress value={m.fineTuned * 100} className="mt-2 h-1.5" />
            <p className="mt-1.5 text-[11px] text-ink-soft">{m.description}</p>
          </div>
        );
      })}
    </div>
  );
}
