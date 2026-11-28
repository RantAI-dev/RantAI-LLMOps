"use client";

import { History } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { GwErrorState, Loading, PageIntro, Panel, Pill, Spinner, arr, fmtAgo, fmtInt, fmtMs, fmtNum, rec, str } from "@/modules/duo/components/duo-ui";
import { LoadRun, LoadTestForm, TD, TH, modeLabel, setName, type PromptSets } from "@/modules/duo/components/speed/load-test";
import { Protocol, protocolRows } from "@/modules/duo/components/speed/protocol";
import { StageBreakdown } from "@/modules/duo/components/speed/stage-breakdown";
import { useGw } from "@/modules/duo/lib/gw";

type Run = Record<string, unknown>;
const when = (r: Run) => str(r.created_at ?? r.started_at ?? r.finished_at, "");

function RunHistory({ runs, current, onOpen }: { runs: Run[]; current: string | null; onOpen: (r: Run) => void }) {
  return (
    <Panel title="Past runs" info="Every load test on this gateway, newest first. Click one to see its results." bodyClassName="p-0">
      {runs.length === 0 ? (
        <EmptyState icon={History} title="No runs yet" description="Start a load test above; its results are kept here." className="m-4" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                {["When", "Questions", "Mode", "Users", "Answered", "Typical (p50)", "p95", "p99", ""].map((h, i) => (
                  <th key={i} className={TH}>
                    {h || <span className="sr-only">Status</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const id = str(r.run_id, "");
                const req = rec(r.request);
                const x = rec(r.results);
                const lat = rec(x.latency_ms);
                const proto = r.kind === "protocol";
                const rows = proto ? protocolRows(r) : [];
                const v = rec(r.nfr007);
                return (
                  <tr key={id} className={cn("cursor-pointer border-t border-hairline hover:bg-surface-2", current === id && "bg-primary-soft")} onClick={() => onOpen(r)}>
                    <td className={cn(TD, "whitespace-nowrap")}>
                      <button
                        type="button"
                        className="font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpen(r);
                        }}
                      >
                        {fmtAgo(when(r))}
                      </button>
                    </td>
                    <td className={TD}>{setName(str(req.prompt_set, ""))}</td>
                    <td className={TD}>{modeLabel(req.mode ?? (proto ? "fast" : "auto"))}</td>
                    <td className={TD}>{proto ? `standard ${arr<number>(req.levels).join("/") || "1/2/4"}` : fmtInt(req.concurrency)}</td>
                    <td className={cn(TD, "tabular-nums")}>{proto ? fmtInt(rows.reduce((a, x) => a + (typeof x.ok === "number" ? x.ok : 0), 0)) : fmtInt(x.ok)}</td>
                    {proto ? (
                      <td className={TD} colSpan={3}>
                        {v.pass == null ? "–" : <Pill tone={v.pass ? "good" : "warn"}>{`target ${v.pass ? "met" : "missed"} (${fmtNum(v.ratio, 2)}×)`}</Pill>}
                      </td>
                    ) : (
                      <>
                        <td className={cn(TD, "tabular-nums")}>{fmtMs(lat.p50)}</td>
                        <td className={cn(TD, "tabular-nums")}>{fmtMs(lat.p95)}</td>
                        <td className={cn(TD, "tabular-nums")}>{fmtMs(lat.p99)}</td>
                      </>
                    )}
                    <td className={TD}>
                      {r.status === "running" ? (
                        <Spinner />
                      ) : r.status === "cancelled" ? (
                        <Pill tone="warn">cancelled</Pill>
                      ) : r.status === "interrupted" || r.status === "failed" ? (
                        <Pill tone="bad">{str(r.status)}</Pill>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** /duo/speed: where the time of each answer goes, and how response times hold up under load. */
export function DuoSpeed() {
  const sets = useGw<PromptSets>("/v1/bench/prompt-sets");
  const [anyRunning, setAnyRunning] = useState(false);
  const runsQ = useGw<unknown[]>("/v1/bench/runs", { refreshMs: anyRunning ? 5000 : 0 });
  // The gateway lists runs newest first; progress documents of a running test carry no dates, so no re-sorting here.
  const runs = useMemo(() => arr(runsQ.data).filter((r) => str(r.run_id, "") && r.kind !== "engines"), [runsQ.data]);
  const [bench, setBench] = useState<string | null>(null);
  const [proto, setProto] = useState<string | null>(null);
  const [promptSet, setPromptSet] = useState("chat-short");
  const [maxTokens, setMaxTokens] = useState(128);

  const running = runs.some((r) => r.status === "running");
  // Poll the list while anything runs (adjusted during render, not in an effect).
  if (running !== anyRunning) setAnyRunning(running);
  // Until a run is chosen, show the newest of each kind; the prompt set falls back to the first the gateway has.
  const benchId = bench ?? (str(runs.find((r) => r.kind !== "protocol")?.run_id, "") || null);
  const protoId = proto ?? (str(runs.find((r) => r.kind === "protocol")?.run_id, "") || null);
  const setKeys = Object.keys(rec(sets.data));
  const promptSetIn = setKeys.length && !setKeys.includes(promptSet) ? setKeys[0] : promptSet;

  const reload = runsQ.reload;
  const refresh = useCallback(() => void reload(), [reload]);

  return (
    <div className="space-y-4 pb-8">
      <PageIntro title="How fast are answers?">
        Where the time of each answer goes, and how response times hold up when several people ask at once. Times measured while other programs share
        this computer are upper bounds.
      </PageIntro>
      <StageBreakdown />
      {sets.error && !sets.data ? (
        <GwErrorState error={sets.error} onRetry={() => sets.reload(false)} what="the load test" />
      ) : (
        <LoadTestForm
          sets={rec(sets.data) as PromptSets}
          running={running}
          promptSet={promptSetIn}
          onPromptSet={setPromptSet}
          maxTokens={maxTokens}
          onMaxTokens={setMaxTokens}
          onStarted={(id) => {
            setBench(id);
            refresh();
          }}
        />
      )}
      {benchId ? <LoadRun key={benchId} runId={benchId} onEnded={refresh} /> : null}
      <Protocol
        runId={protoId}
        promptSet={promptSetIn}
        maxTokens={maxTokens}
        busy={running}
        onStarted={(id) => {
          setProto(id);
          refresh();
        }}
        onEnded={refresh}
      />
      {runsQ.error && !runsQ.data ? (
        <GwErrorState error={runsQ.error} onRetry={() => runsQ.reload(false)} what="past runs" />
      ) : runsQ.loading && !runsQ.data ? (
        <Loading label="Loading past runs…" />
      ) : (
        <RunHistory
          runs={runs}
          current={benchId}
          onOpen={(r) => {
            const id = str(r.run_id, "");
            if (r.kind === "protocol") setProto(id);
            else setBench(id);
          }}
        />
      )}
    </div>
  );
}
