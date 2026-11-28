"use client";

import { ListChecks, Play, Square } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { GwErrorState, Loading, Note, Panel, Pill, Spinner, arr, fmtAgo, fmtInt, fmtMs, fmtNum, fmtPct, rec, str } from "@/modules/duo/components/duo-ui";
import { TD, TH, setName } from "@/modules/duo/components/speed/load-test";
import { useRun } from "@/modules/duo/components/experiments/use-run";
import { GwError, gw } from "@/modules/duo/lib/gw";

const LEVELS = [1, 2, 4];
const PER_SESSION = 8;

/** The protocol's rows: its final table, or the levels finished so far while it runs. */
export function protocolRows(r: Record<string, unknown>): Array<Record<string, unknown>> {
  const table = arr(r.table);
  if (table.length) return table;
  return arr(r.levels).map((l) => {
    const x = rec(l.results);
    const lat = rec(x.latency_ms);
    return {
      concurrency: l.concurrency,
      requests: x.requests,
      ok: x.ok,
      p50_ms: lat.p50,
      p95_ms: lat.p95,
      p99_ms: lat.p99,
      ttft_p95_ms: rec(x.ttft_ms).p95,
      throughput_rps: x.throughput_rps,
      escalation_rate: x.escalation_rate,
      cost_per_request_s: x.cost_per_request_s,
    };
  });
}

function Result({ runId, onEnded }: { runId: string; onEnded: () => void }) {
  const { data, error, loading, reload, status } = useRun(`/v1/bench/runs/${encodeURIComponent(runId)}`, 3000, onEnded);
  const [cancelling, setCancelling] = useState(false);
  const r = rec(data);

  if (loading && !data) return <Loading label="Loading the standard load test…" />;
  if (error && !data) return <GwErrorState error={error} onRetry={() => reload(false)} what="the standard load test" />;
  const rows = protocolRows(r);
  const v = rec(r.nfr007);
  const req = rec(r.request);
  const levels = arr<number>(req.levels).length ? arr<number>(req.levels) : LEVELS;
  const isRunning = status === "running";
  const step = typeof r.level_index === "number" ? r.level_index + 1 : rows.length + 1;
  const firstN = typeof rows[0]?.requests === "number" ? (rows[0].requests as number) : 0;

  async function cancel() {
    setCancelling(true);
    try {
      await gw(`/v1/bench/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
      toast.success("Stopping once the current answers finish…");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{setName(str(req.prompt_set, ""))}</span>
        <span className="text-xs text-ink-soft">
          {levels.join(", ")} users · {fmtInt(req.requests_per_session ?? PER_SESSION)} questions per user · {fmtAgo(r.started_at ?? r.created_at)}
        </span>
        {isRunning ? (
          <>
            <Pill tone="info">
              <Spinner className="size-3" /> Running step {Math.min(step, levels.length)} of {levels.length}
            </Pill>
            <Button size="xs" variant="outline" onClick={cancel} disabled={cancelling}>
              <Square /> Cancel
            </Button>
          </>
        ) : status === "cancelled" ? (
          <Pill tone="warn">Cancelled</Pill>
        ) : null}
      </div>
      {rows.length ? (
        <div className="overflow-x-auto rounded-md border border-hairline">
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                {["Users", "Questions", "Answered", "Typical (p50)", "p95", "p99", "First words (p95)", "Answers per minute", "System 2", "Model time per answer"].map((h) => (
                  <th key={h} className={TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((x, i) => (
                <tr key={i} className="border-t border-hairline">
                  <td className={cn(TD, "font-semibold")}>{fmtInt(x.concurrency)}</td>
                  <td className={cn(TD, "tabular-nums")}>{fmtInt(x.requests)}</td>
                  <td className={cn(TD, "tabular-nums")}>{fmtInt(x.ok)}</td>
                  <td className={cn(TD, "tabular-nums")}>{fmtMs(x.p50_ms)}</td>
                  <td className={cn(TD, "tabular-nums")}>{fmtMs(x.p95_ms)}</td>
                  <td className={cn(TD, "tabular-nums")}>{fmtMs(x.p99_ms)}</td>
                  <td className={cn(TD, "tabular-nums")}>{fmtMs(x.ttft_p95_ms)}</td>
                  <td className={cn(TD, "tabular-nums")}>{fmtNum(typeof x.throughput_rps === "number" ? x.throughput_rps * 60 : null, 1)}</td>
                  <td className={cn(TD, "tabular-nums")}>{fmtPct(x.escalation_rate)}</td>
                  <td className={cn(TD, "tabular-nums")}>{typeof x.cost_per_request_s === "number" ? `${fmtNum(x.cost_per_request_s, 1)} s` : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : isRunning ? (
        <p className="text-sm text-ink-soft">The first step is running; its row appears when it finishes.</p>
      ) : null}
      {!isRunning && rows.length ? (
        v.pass == null ? (
          <Note>The verdict needs the steps with 1 and 2 users.</Note>
        ) : (
          <Note tone={v.pass ? "good" : "warn"}>
            <strong>{v.pass ? "Target met." : "Target missed."}</strong> With {fmtInt(v.limit_sessions ?? 2)} users the slowest 5% of answers took {fmtNum(v.ratio, 2)}× as
            long as with one user (target: 2× or less)
            {typeof v.ratio_at_4 === "number" ? `; with 4 users ${fmtNum(v.ratio_at_4, 2)}×` : ""}.
            {firstN > 0 && firstN < 8 ? ` Rough: only ${firstN} questions per step, so the slowest 5% is just the slowest answer.` : ""}
            {v.pass ? "" : " One run can miss when other programs share the computer; run it again before drawing conclusions."}
          </Note>
        )
      ) : null}
    </div>
  );
}

/**
 * The standard load test (/v1/bench/protocol): the same questions with 1, then 2, then 4 simultaneous users. The
 * recorded target: with 2 users, the slowest 5% of answers take at most twice as long as with one.
 */
export function Protocol({
  runId,
  promptSet,
  maxTokens,
  busy: otherRunning,
  onStarted,
  onEnded,
}: {
  runId: string | null;
  promptSet: string;
  maxTokens: number;
  busy: boolean;
  onStarted: (id: string) => void;
  onEnded: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [starting, setStarting] = useState(false);
  async function start() {
    setStarting(true);
    try {
      const r = await gw<{ run_id?: string }>("/v1/bench/protocol", {
        method: "POST",
        body: { prompt_set: promptSet, mode: "fast", levels: LEVELS, requests_per_session: PER_SESSION, max_tokens: maxTokens },
      });
      if (!r?.run_id) throw new GwError("The gateway did not return a run id", 502);
      toast.success("Standard load test started: 1, 2, then 4 users");
      setConfirm(false);
      onStarted(r.run_id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }
  return (
    <Panel
      title="Standard load test"
      info="The same questions with 1, 2 and 4 simultaneous users, System 1 only. The target: with 2 users, the slowest 5% of answers take at most twice as long as with one user."
      actions={
        <Button size="sm" onClick={() => setConfirm(true)} disabled={otherRunning}>
          <Play /> Run the standard load test
        </Button>
      }
    >
      {runId ? (
        <Result key={runId} runId={runId} onEnded={onEnded} />
      ) : (
        <EmptyState icon={ListChecks} title="No standard load test yet" description="Run it once to record how response times hold up when several people ask at once." />
      )}
      <Dialog open={confirm} onOpenChange={(o) => !starting && setConfirm(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Run the standard load test?</DialogTitle>
            <DialogDescription>
              The same questions ({setName(promptSet)}) are asked with 1, then 2, then 4 simultaneous users, {PER_SESSION} questions each. It takes several
              minutes, and everyone&apos;s answers are slower while it runs.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={starting}>
              Not now
            </Button>
            <Button onClick={start} disabled={starting}>
              {starting ? <Spinner className="text-primary-foreground" /> : <Play />}
              Run the test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
