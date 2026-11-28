"use client";

import { Play } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GwErrorState, Loading, PageIntro, arr, str } from "@/modules/duo/components/duo-ui";
import { DuoStrategies } from "@/modules/duo/components/duo-strategies";
import { DatasetBrowser, toDatasets } from "@/modules/duo/components/experiments/dataset-browser";
import { Insights } from "@/modules/duo/components/experiments/insights";
import { NewExperiment } from "@/modules/duo/components/experiments/new-experiment";
import { RunDetail } from "@/modules/duo/components/experiments/run-detail";
import { RunList, type RawRun } from "@/modules/duo/components/experiments/run-list";
import { useGw } from "@/modules/duo/lib/gw";

type Tab = "runs" | "compare" | "insights" | "datasets";
const when = (r: RawRun) => str(r.started_at ?? r.created_at, "");

/** /duo/experiments: run the same questions through several answering strategies and compare them. */
export function DuoExperiments() {
  const [tab, setTab] = useState<Tab>("runs");
  const ds = useGw<unknown[]>("/v1/eval/datasets");
  const [anyRunning, setAnyRunning] = useState(false);
  const runsQ = useGw<unknown[]>("/v1/eval/runs", { refreshMs: anyRunning ? 10_000 : 0 });
  const datasets = useMemo(() => toDatasets(ds.data), [ds.data]);
  const runs = useMemo(() => arr(runsQ.data).filter((r) => str(r.run_id, "")).sort((a, b) => when(b).localeCompare(when(a))), [runsQ.data]);
  const [dataset, setDataset] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  // Bumped when a run is resumed from the list, so the detail remounts, reloads and follows the now-running run.
  const [resumes, setResumes] = useState(0);
  const formRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const running = runs.some((r) => r.status === "running");
  // Poll the list while anything runs (adjusted during render, not in an effect).
  if (running !== anyRunning) setAnyRunning(running);
  // Until the user picks, use the smallest mixed set and show the newest experiment.
  const datasetIn = dataset || (datasets.find((d) => d.name === "smoke_mixed")?.name ?? datasets[0]?.name ?? "");
  const selectedId = selected ?? (str(runs[0]?.run_id, "") || null);

  const reloadRuns = runsQ.reload;
  const onChanged = useCallback(() => void reloadRuns(), [reloadRuns]);
  const open = (id: string) => {
    setSelected(id);
    setTab("runs");
    setTimeout(() => detailRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 50);
  };

  const fatal = runsQ.error && !runsQ.data ? runsQ.error : null;
  return (
    <div className="space-y-4 pb-8">
      <PageIntro
        title="When is thinking longer worth the wait?"
        actions={
          <Button
            size="sm"
            onClick={() => {
              setTab("runs");
              setTimeout(() => formRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 50);
            }}
          >
            <Play /> New experiment
          </Button>
        }
      >
        Run the same questions through several answering strategies and compare them side by side. Every answer is scored by an exact check, never
        by opinion.
      </PageIntro>

      {fatal ? (
        <GwErrorState error={fatal} onRetry={() => runsQ.reload(false)} what="the experiments" />
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="runs">Experiments</TabsTrigger>
            <TabsTrigger value="compare">Compare strategies</TabsTrigger>
            <TabsTrigger value="insights">Which strategy wins?</TabsTrigger>
            <TabsTrigger value="datasets">Question sets</TabsTrigger>
          </TabsList>

          <TabsContent value="runs" className="mt-2 space-y-4">
            <div ref={formRef}>
              {ds.error && !ds.data ? (
                <GwErrorState error={ds.error} onRetry={() => ds.reload(false)} what="the question sets" />
              ) : ds.loading && !ds.data ? (
                <Loading label="Loading the question sets…" />
              ) : (
                <NewExperiment datasets={datasets} dataset={datasetIn} onDataset={setDataset} onStarted={(id) => { void runsQ.reload(); open(id); }} />
              )}
            </div>
            <div ref={detailRef} className="scroll-mt-4">
              {selectedId ? <RunDetail key={`${selectedId}#${resumes}`} runId={selectedId} onChanged={onChanged} /> : null}
            </div>
            {runsQ.loading && !runsQ.data ? <Loading label="Loading the experiments…" /> : <RunList runs={runs} selected={selectedId} onSelect={open} onChanged={onChanged} onResumed={() => setResumes((n) => n + 1)} />}
          </TabsContent>

          <TabsContent value="compare" className="mt-2">
            <DuoStrategies />
          </TabsContent>

          <TabsContent value="insights" className="mt-2">
            <Insights />
          </TabsContent>

          <TabsContent value="datasets" className="mt-2">
            {ds.error && !ds.data ? (
              <GwErrorState error={ds.error} onRetry={() => ds.reload(false)} what="the question sets" />
            ) : ds.loading && !ds.data ? (
              <Loading label="Loading the question sets…" />
            ) : (
              <DatasetBrowser
                datasets={datasets}
                onUse={(n) => {
                  setDataset(n);
                  setTab("runs");
                  setTimeout(() => formRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 50);
                }}
              />
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
