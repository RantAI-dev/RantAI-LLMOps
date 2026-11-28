"use client";

import { Download, RotateCw, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { DuoStrategyPoint } from "@/lib/duo-evals";
import { cn } from "@/lib/utils";
import {
  CodeBlock,
  GwErrorState,
  KV,
  Loading,
  Meter,
  Note,
  Panel,
  Pill,
  Segmented,
  Spinner,
  Stat,
  StatGrid,
  arr,
  fmtInt,
  fmtMs,
  fmtNum,
  fmtPct,
  rec,
  str,
} from "@/modules/duo/components/duo-ui";
import { FrontierChart, PointsTable, finding } from "@/modules/duo/components/duo-strategies";
import { CalibrateButton } from "@/modules/duo/components/experiments/calibrate-dialog";
import { canResume, runStatus, sysHelp, sysLabel } from "@/modules/duo/components/experiments/labels";
import { Reliability, toReliability } from "@/modules/duo/components/experiments/reliability";
import { TD, TH, runAction, type RawRun } from "@/modules/duo/components/experiments/run-list";
import { assuranceInfo, modeInfo } from "@/modules/duo/components/status/words";
import { useRun } from "@/modules/duo/components/experiments/use-run";
import { gwDownload, saveBlob } from "@/modules/duo/lib/gw";

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const ci = (c: unknown, d = 1) => {
  const a = arr<number>(c);
  return a.length === 2 && num(a[0]) !== null && num(a[1]) !== null ? `${(a[0] * 100).toFixed(d)}–${(a[1] * 100).toFixed(d)}%` : "–";
};
const pts = (x: unknown) => (num(x) === null ? "–" : `${(x as number) >= 0 ? "+" : ""}${((x as number) * 100).toFixed(1)} pts`);

/** Where each strategy lands on accuracy against time, from the run's frontier (or its systems when it has none). */
export function strategyPoints(run: RawRun): DuoStrategyPoint[] {
  const sys = rec(run.systems);
  const front = new Map(arr(run.frontier).map((f) => [str(f.system, ""), f]));
  const points: DuoStrategyPoint[] = Object.entries(sys).map(([system, raw]) => {
    const s = rec(raw);
    const f = front.get(system);
    const c = arr<number>(s.accuracy_ci95);
    const wall = num(s.mean_wall_ms);
    return {
      system,
      label: sysLabel(system),
      accuracy: num(s.accuracy),
      ci: c.length === 2 && num(c[0]) !== null && num(c[1]) !== null ? [c[0], c[1]] : null,
      meanCostS: (f && num(f.mean_cost_s)) ?? (wall !== null ? wall / 1000 : null),
      costVsSlow: f ? num(f.cost_vs_slow) : null,
      pareto: f ? f.pareto === true : false,
      n: num(s.n),
      escalationRate: num(s.escalation_rate),
      meanModelCalls: num(s.mean_model_calls),
      meanReasoningTokens: num(s.mean_reasoning_tokens),
    };
  });
  if (!front.size) {
    const slow = points.find((p) => p.system === "slow_only")?.meanCostS;
    for (const p of points) {
      if (slow && p.meanCostS !== null) p.costVsSlow = p.meanCostS / slow;
      if (p.accuracy === null || p.meanCostS === null) continue;
      p.pareto = !points.some(
        (q) => q !== p && q.accuracy !== null && q.meanCostS !== null && q.accuracy >= p.accuracy! && q.meanCostS <= p.meanCostS! && (q.accuracy > p.accuracy! || q.meanCostS < p.meanCostS!)
      );
    }
  }
  return points.sort((a, b) => (a.meanCostS ?? Infinity) - (b.meanCostS ?? Infinity));
}

/** Shares of each assurance level, as one stacked bar. */
function AssuranceBar({ counts, n }: { counts: unknown; n: unknown }) {
  const c = Object.entries(rec(counts)).filter(([, v]) => typeof v === "number" && v > 0) as Array<[string, number]>;
  const total = Math.max(1, num(n) ?? c.reduce((a, [, v]) => a + v, 0));
  const color: Record<string, string> = { verified: "bg-success", consensus: "bg-info", unverified: "bg-ink-faint", abstained: "bg-warning", error: "bg-danger" };
  if (!c.length) return <span className="text-ink-faint">–</span>;
  return (
    <div className="flex h-2 w-28 overflow-hidden rounded-full bg-surface-2" title={c.map(([k, v]) => `${assuranceInfo(k).label}: ${v}`).join(", ")}>
      {c.map(([k, v]) => (
        <span key={k} className={cn("h-full", color[k] ?? "bg-chart-4")} style={{ width: `${(v / total) * 100}%` }} />
      ))}
    </div>
  );
}

function StrategiesTable({ run }: { run: RawRun }) {
  const sys = Object.entries(rec(run.systems));
  if (!sys.length) return null;
  return (
    <Panel title="Strategies" info="Every strategy answered the same questions. 'When it answered' is accuracy on the questions it did not decline." bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2">
            <tr>
              {["Strategy", "Questions", "Accuracy", "95% interval", "When it answered", "Answered", "System 2 used", "Average / slowest 5%", "First words", "Model calls", "Thinking tokens", "How sure"].map((h) => (
                <th key={h} className={TH}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sys.map(([k, raw]) => {
              const x = rec(raw);
              return (
                <tr key={k} className="border-t border-hairline">
                  <td className={TD} title={sysHelp(k)}>
                    {sysLabel(k)}
                  </td>
                  <td className={cn(TD, "tabular-nums")}>
                    {fmtInt(x.n)}
                    {num(x.errors) ? (
                      <Pill tone="bad" className="ml-1">
                        {fmtInt(x.errors)} failed
                      </Pill>
                    ) : null}
                  </td>
                  <td className={cn(TD, "font-semibold tabular-nums")}>{fmtPct(x.accuracy, 1)}</td>
                  <td className={cn(TD, "text-xs whitespace-nowrap text-ink-soft")}>{ci(x.accuracy_ci95)}</td>
                  <td className={cn(TD, "tabular-nums")}>{fmtPct(x.selective_accuracy, 1)}</td>
                  <td className={cn(TD, "tabular-nums")}>{fmtPct(x.coverage)}</td>
                  <td className={cn(TD, "tabular-nums")}>{fmtPct(x.escalation_rate)}</td>
                  <td className={cn(TD, "whitespace-nowrap tabular-nums")}>
                    {fmtMs(x.mean_wall_ms)} / {fmtMs(x.p95_wall_ms)}
                  </td>
                  <td className={cn(TD, "tabular-nums")}>{fmtMs(x.mean_ttft_ms)}</td>
                  <td className={cn(TD, "tabular-nums")}>{fmtNum(x.mean_model_calls, 1)}</td>
                  <td className={cn(TD, "tabular-nums")}>{fmtInt(x.mean_reasoning_tokens)}</td>
                  <td className={TD}>
                    <AssuranceBar counts={x.assurance} n={x.n} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** A forest-plot cell: the 95% interval and the point on a −50 … +50 point axis. */
function Forest({ delta, interval }: { delta: unknown; interval: unknown }) {
  const c = arr<number>(interval);
  const d = num(delta);
  if (c.length !== 2 || d === null) return <span className="text-xs text-ink-faint">after the run</span>;
  const L = (x: number) => Math.max(0, Math.min(100, 50 + x * 100));
  return (
    <div className="relative h-3 w-40 rounded bg-surface-2" aria-label={`Difference ${pts(d)}, interval ${pts(c[0])} to ${pts(c[1])}`} role="img">
      <span className="absolute inset-y-0 left-1/2 w-px bg-ink-faint" aria-hidden />
      <span className="absolute top-1 h-1 rounded bg-primary/40" style={{ left: `${L(c[0])}%`, width: `${Math.max(1, L(c[1]) - L(c[0]))}%` }} aria-hidden />
      <span className="absolute top-0 size-3 -translate-x-1/2 rounded-full border-2 border-primary bg-background" style={{ left: `${L(d)}%` }} aria-hidden />
    </div>
  );
}

function Paired({ run }: { run: RawRun }) {
  const rows = arr(run.paired);
  if (!rows.length) return null;
  return (
    <Panel
      title="Head to head"
      info="Differences on the same questions, with 95% intervals. A firm 'no worse' verdict needs about 700 pairs (within 3 points). 'Luck?' is the chance of a difference this large by luck alone (McNemar), then adjusted for the number of comparisons (Bonferroni)."
      bodyClassName="p-0"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2">
            <tr>
              {["Comparison", "Pairs", "Accuracy difference", "95% interval", "−50 … 0 … +50 points", "Luck?", "Time ratio", "No worse (3 points)"].map((h) => (
                <th key={h} className={TH}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const nPairs = num(p.n_pairs) ?? 0;
              const disc = rec(p.discordant);
              const c = arr<number>(p.ci95);
              return (
                <tr key={i} className="border-t border-hairline">
                  <td className={TD}>
                    {sysLabel(str(p.a))} <span className="text-ink-faint">vs</span> {sysLabel(str(p.b))}
                  </td>
                  <td className={cn(TD, "tabular-nums")}>{fmtInt(p.n_pairs)}</td>
                  <td className={cn(TD, "font-semibold tabular-nums")}>{pts(p.delta_accuracy)}</td>
                  <td className={cn(TD, "text-xs whitespace-nowrap text-ink-soft")}>{c.length === 2 ? `${pts(c[0])} to ${pts(c[1])}` : "–"}</td>
                  <td className={TD}>
                    <Forest delta={p.delta_accuracy} interval={p.ci95} />
                  </td>
                  <td
                    className={cn(TD, "tabular-nums")}
                    title={`${fmtInt(disc.only_a_correct ?? 0)} questions only the first got right, ${fmtInt(disc.only_b_correct ?? 0)} only the second`}
                  >
                    {fmtNum(p.mcnemar_p, 3)} / {fmtNum(p.p_bonferroni, 3)}
                  </td>
                  <td className={cn(TD, "tabular-nums")}>{num(p.cost_ratio) === null ? "–" : `${fmtNum(p.cost_ratio, 2)}×`}</td>
                  <td className={TD}>
                    <span className="flex flex-wrap gap-1">
                      {p.non_inferior_3pt == null ? "–" : p.non_inferior_3pt ? <Pill tone="good">Yes</Pill> : <Pill>No</Pill>}
                      {nPairs < 700 ? (
                        <Pill tone="warn" title="A firm verdict needs at least 700 pairs">
                          rough
                        </Pill>
                      ) : null}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Routing({ run }: { run: RawRun }) {
  const rt = Object.entries(rec(run.routing));
  if (!rt.length) return null;
  return (
    <>
      {rt.map(([k, raw]) => {
        const r = rec(raw);
        const conf = rec(r.confusion);
        return (
          <Panel
            key={k}
            title={`Routing choices · ${sysLabel(k)}`}
            actions={r.measures_gate ? <Pill tone="good">measures the routing</Pill> : <Pill>decided by checks</Pill>}
          >
            <StatGrid className="sm:grid-cols-2 lg:grid-cols-2">
              <Stat label="Best choice made" value={fmtPct(r.routing_accuracy)} hint="target 70% or more" />
              <Stat label="Sent to System 2" value={fmtPct(r.escalation_rate)} hint={`${fmtInt(r.n)} questions`} />
            </StatGrid>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr>
                  <th className={TH} />
                  <th className={TH}>Needed System 2</th>
                  <th className={TH}>System 1 was enough</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-hairline">
                  <td className={TD}>Called System 2</td>
                  <td className={TD}>
                    <strong>{fmtInt(conf.escalate_needed ?? 0)}</strong> right call
                  </td>
                  <td className={TD}>{fmtInt(conf.escalate_wasted ?? 0)} wasted time</td>
                </tr>
                <tr className="border-t border-hairline">
                  <td className={TD}>Kept System 1</td>
                  <td className={TD}>{fmtInt(conf.keep_missed ?? 0)} missed</td>
                  <td className={TD}>
                    <strong>{fmtInt(conf.keep_correct ?? 0)}</strong> right call
                  </td>
                </tr>
              </tbody>
            </table>
            {str(r.note, "") ? <p className="mt-2 text-xs text-ink-soft">{str(r.note)}</p> : null}
          </Panel>
        );
      })}
    </>
  );
}

function Calibration({ run, runId, running }: { run: RawRun; runId: string; running: boolean }) {
  const cal = run.calibration ? rec(run.calibration) : null;
  if (!cal) return null;
  const bins = toReliability(cal.reliability);
  return (
    <Panel title="How well the gate predicts mistakes" actions={<CalibrateButton runId={runId} disabled={running} />}>
      <StatGrid className="sm:grid-cols-3 lg:grid-cols-3">
        <Stat label="Calibration error" value={fmtNum(cal.ece_e1, 3)} hint="0.05 or less is good" />
        <Stat label="Brier score" value={fmtNum(cal.brier_e1, 3)} hint={`${fmtInt(cal.n)} checked quick answers`} />
        <Stat label="Quick answers wrong" value={fmtPct(cal.draft_error_rate)} hint={str(cal.calibration_in_use, "")} />
      </StatGrid>
      {bins.length ? <Reliability points={bins} /> : null}
      {str(cal.note, "") ? <p className="mt-2 text-xs text-ink-soft">{str(cal.note)}</p> : null}
    </Panel>
  );
}

function Coupling({ run }: { run: RawRun }) {
  const cp = run.coupling ? rec(run.coupling) : null;
  if (!cp) return null;
  const rows: Array<[string, string]> = [
    ["draft_blind", "Does not see the draft (in use)"],
    ["draft_conditioned", "Sees the draft (test)"],
  ];
  return (
    <Panel title="Independence test" info="How often System 2 repeats a wrong quick draft. It should stay at 5% or less." bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-surface-2">
            <tr>
              {["System 2 answer", "Wrong drafts", "Copied", "Copy rate", "At most (95%)", "Within 5%?"].map((h) => (
                <th key={h} className={TH}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, label]) => {
              const x = cp[k] ? rec(cp[k]) : null;
              if (!x) return null;
              return (
                <tr key={k} className="border-t border-hairline">
                  <td className={TD}>{label}</td>
                  <td className={TD}>{fmtInt(x.wrong_drafts)}</td>
                  <td className={TD}>{fmtInt(x.adopted)}</td>
                  <td className={cn(TD, "font-semibold")}>{fmtPct(x.adoption_rate, 1)}</td>
                  <td className={TD}>≤ {fmtPct(x.upper95, 1)}</td>
                  <td className={TD}>{x.h5_pass ? <Pill tone="good">Yes</Pill> : <Pill>Not shown</Pill>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {str(cp.note, "") ? <p className="px-4 py-2 text-xs text-ink-soft">{str(cp.note)}</p> : null}
    </Panel>
  );
}

function BudgetCurve({ run }: { run: RawRun }) {
  const bc = Object.entries(rec(run.budget_curve));
  if (!bc.length) return null;
  return (
    <Panel title="Accuracy against thinking budget" bodyClassName="p-0">
      <table className="w-full text-sm">
        <thead className="bg-surface-2">
          <tr>
            <th className={TH}>Topic</th>
            <th className={TH}>Measured</th>
            <th className={TH}>Best budget</th>
          </tr>
        </thead>
        <tbody>
          {bc.map(([d, raw]) => {
            const v = rec(raw);
            return (
              <tr key={d} className="border-t border-hairline">
                <td className={TD}>{d}</td>
                <td className={cn(TD, "text-xs")}>
                  {arr(v.points)
                    .map((p) => `${fmtInt(p.budget)}: ${fmtPct(p.accuracy)} · ${fmtNum(p.mean_wall_s, 0)} s`)
                    .join(" · ") || "–"}
                </td>
                <td className={cn(TD, "font-semibold")}>{v.b_star == null ? "–" : fmtInt(v.b_star)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}

type Filter = "all" | "wrong" | "right" | "slow" | "err";
const PAGE = 200;

function Answers({ run }: { run: RawRun }) {
  const all = arr(run.items);
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Record<string, unknown> | null>(null);
  const rows = all.filter(
    (i) =>
      filter === "all" ||
      (filter === "wrong" && i.correct === false) ||
      (filter === "right" && i.correct === true) ||
      (filter === "slow" && (i.escalated === true || i.mode === "slow")) ||
      (filter === "err" && Boolean(i.error))
  );
  if (!all.length) return null;
  return (
    <Panel
      title="Answers"
      info="Every answer of every strategy. Click a row to read the answer and what the check found."
      actions={
        <Segmented<Filter>
          label="Show answers"
          value={filter}
          onChange={(f) => {
            setFilter(f);
            setLimit(PAGE);
          }}
          options={[
            { id: "all", label: `All (${all.length})` },
            { id: "wrong", label: "Wrong" },
            { id: "right", label: "Right" },
            { id: "slow", label: "System 2" },
            { id: "err", label: "Failed" },
          ]}
        />
      }
      bodyClassName="p-0"
    >
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-soft">No answers match this filter.</p>
      ) : (
        <div className="max-h-[480px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2">
              <tr>
                {["Question", "Strategy", "Result", "Answered by", "How sure", "Risk", "Draft", "Time", "Answer"].map((h) => (
                  <th key={h} className={TH} title={h === "Risk" ? "Predicted chance that the quick answer is wrong" : h === "Draft" ? "Was the quick draft right?" : undefined}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((i, ix) => {
                const m = modeInfo(i.mode);
                const a = assuranceInfo(i.assurance);
                return (
                  <tr key={ix} className="cursor-pointer border-t border-hairline hover:bg-surface-2" onClick={() => setOpen(i)}>
                    <td className={cn(TD, "font-mono text-xs")}>
                      <button
                        type="button"
                        className="text-left hover:underline focus-visible:underline focus-visible:outline-none"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(i);
                        }}
                      >
                        {str(i.task_id)}
                      </button>
                    </td>
                    <td className={cn(TD, "text-xs")}>{sysLabel(str(i.system))}</td>
                    <td className={TD}>
                      {i.error ? <Pill tone="bad">Failed</Pill> : i.correct == null ? <Pill>No check</Pill> : i.correct ? <Pill tone="good">Right</Pill> : <Pill tone="bad">Wrong</Pill>}
                    </td>
                    <td className={TD}>{i.mode === "fast" || i.mode === "slow" ? <Pill tone={m.tone}>{m.label}</Pill> : <span className="text-ink-faint">–</span>}</td>
                    <td className={TD}>
                      <Pill tone={a.tone} title={a.hint}>
                        {a.label}
                      </Pill>
                    </td>
                    <td className={cn(TD, "tabular-nums")}>{fmtNum(i.e1_hat, 2)}</td>
                    <td className={TD}>{i.draft_correct == null ? "–" : i.draft_correct ? "✓" : "✗"}</td>
                    <td className={cn(TD, "whitespace-nowrap tabular-nums")}>{fmtMs(i.wall_ms)}</td>
                    <td className={cn(TD, "max-w-80 truncate text-xs text-ink-soft")}>{str(i.error ?? i.answer_preview, "")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > limit ? (
            <div className="flex items-center justify-center gap-2 border-t border-hairline p-2 text-xs text-ink-soft">
              Showing {limit} of {rows.length}.
              <Button size="xs" variant="outline" onClick={() => setLimit((l) => l + PAGE)}>
                Show more
              </Button>
            </div>
          ) : null}
        </div>
      )}
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-2xl">
          {open ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {str(open.task_id)} · {sysLabel(str(open.system))}
                </DialogTitle>
                <DialogDescription>
                  {modeInfo(open.mode).label} · {assuranceInfo(open.assurance).label} · {fmtMs(open.wall_ms)} · {fmtInt(open.model_calls)} model calls ·{" "}
                  {fmtInt(open.reasoning_tokens)} thinking tokens
                  {num(open.attempts) ? ` · ${fmtInt(open.attempts)} System 2 attempts` : ""}
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[65vh] space-y-3 overflow-y-auto">
                <div>
                  <h4 className="mb-1 text-xs font-medium text-ink-soft">Answer</h4>
                  <CodeBlock>{str(open.answer_preview, "") || "–"}</CodeBlock>
                </div>
                {str(open.evidence, "") ? (
                  <div>
                    <h4 className="mb-1 text-xs font-medium text-ink-soft">What the check found</h4>
                    <CodeBlock>{str(open.evidence)}</CodeBlock>
                  </div>
                ) : null}
                {str(open.error, "") ? <Note tone="bad">{str(open.error)}</Note> : null}
                {open.features ? (
                  <details>
                    <summary className="cursor-pointer text-xs text-ink-soft">Routing signals</summary>
                    <CodeBlock className="mt-1">{JSON.stringify(open.features, null, 1)}</CodeBlock>
                  </details>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Panel>
  );
}

const FORMATS: Array<{ id: "md" | "csv" | "json"; label: string; hint: string }> = [
  { id: "md", label: "Report (.md)", hint: "A readable report with every table" },
  { id: "csv", label: "Spreadsheet (.csv)", hint: "One row per answer" },
  { id: "json", label: "Data (.json)", hint: "The full run record" },
];

function Exports({ runId }: { runId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  async function get(format: string) {
    setBusy(format);
    try {
      const { blob, name } = await gwDownload(`/v1/eval/runs/${encodeURIComponent(runId)}/export?format=${format}`);
      saveBlob(blob, name === "download" ? `nafs-eval-${runId.slice(0, 8)}.${format}` : name);
    } catch (err) {
      toast.error(`Could not export: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  }
  return (
    <>
      {FORMATS.map((f) => (
        <Button key={f.id} size="sm" variant="ghost" title={f.hint} disabled={busy !== null} onClick={() => get(f.id)}>
          {busy === f.id ? <Spinner className="size-3.5" /> : <Download />}
          {f.label}
        </Button>
      ))}
    </>
  );
}

/** One experiment: live progress while it runs (polled every 3 s, stopping when it ends), then every result. */
export function RunDetail({ runId, onChanged }: { runId: string; onChanged: () => void }) {
  const { data, error, loading, reload, status } = useRun<RawRun>(`/v1/eval/runs/${encodeURIComponent(runId)}`, 3000, onChanged);
  const run = useMemo(() => rec(data), [data]);
  const [acting, setActing] = useState(false);
  // The status a stop or resume was accepted on: its buttons stay disabled until the run shows a new status, so a
  // second click before the reload lands cannot send a second request (cleared during render, not in an effect).
  const [actedOn, setActedOn] = useState<string | null>(null);
  if (actedOn !== null && status && status !== actedOn) setActedOn(null);
  const waiting = acting || (actedOn !== null && actedOn === status);

  const points = useMemo(() => strategyPoints(run), [run]);
  if (loading && !data) return <Loading label="Loading the experiment…" />;
  if (error && !data) return <GwErrorState error={error} onRetry={() => reload(false)} what="this experiment" />;

  const st = runStatus(status);
  const req = rec(run.request);
  const prog = rec(run.progress);
  const done = num(prog.done) ?? 0;
  const total = num(prog.total) ?? 0;
  const text = finding(points);
  const isRunning = status === "running";

  const act = async (a: "cancel" | "resume") => {
    if (waiting) return;
    setActing(true);
    const ok = await runAction(runId, a);
    setActing(false);
    if (ok) {
      setActedOn(status);
      void reload();
      onChanged();
    }
  };

  return (
    <div className="space-y-4">
      <Panel
        title={
          <span className="flex flex-wrap items-center gap-2">
            {str(req.benchmark)} · {arr(req.systems).length || Object.keys(rec(run.systems)).length} strategies
            <Pill tone={st.tone}>
              {isRunning ? <Spinner className="size-3" /> : null}
              {st.label}
            </Pill>
          </span>
        }
        actions={
          <>
            {isRunning ? (
              <Button size="sm" variant="outline" disabled={waiting} onClick={() => act("cancel")}>
                <Square /> Stop
              </Button>
            ) : null}
            {canResume(status) ? (
              <Button size="sm" variant="outline" disabled={waiting} onClick={() => act("resume")} title="Continue where it stopped; finished answers are kept">
                <RotateCw /> Resume
              </Button>
            ) : null}
            {!isRunning && !run.calibration && arr(run.items).length ? <CalibrateButton runId={runId} /> : null}
            <Exports runId={runId} />
          </>
        }
      >
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-ink-soft" aria-live="polite">
              {fmtInt(done)} / {total ? fmtInt(total) : "?"} answers
              {isRunning ? " · updates every few seconds" : ""}
            </span>
            <span className="font-mono text-xs text-ink-faint">{runId.slice(0, 8)}</span>
          </div>
          <Meter value={total ? done / total : isRunning ? 0 : 1} tone={status === "failed" ? "bad" : status === "done" ? "good" : "info"} label="Experiment progress" />
          {status === "failed" ? <Note tone="bad">The experiment failed{str(run.error, "") ? `: ${str(run.error)}` : "."}</Note> : null}
          {status === "cancelled" ? <Note tone="warn">The experiment was cancelled. Resume it to finish the remaining questions; finished answers are kept.</Note> : null}
          {status === "interrupted" ? <Note tone="warn">The gateway restarted while this experiment ran. Resume it to continue where it stopped.</Note> : null}
          <KV
            className="pt-1"
            rows={[
              ["Questions", `${req.max_items == null ? "all" : fmtInt(req.max_items)}${num(req.offset) ? `, skipping the first ${fmtInt(req.offset)}` : ""}${req.shuffle ? ", random order" : ""}`],
              req.lambda != null ? ["Speed weight (λ)", fmtNum(req.lambda, 2)] : null,
              req.thinking_budget != null ? ["Thinking budget", `${fmtInt(req.thinking_budget)} tokens`] : null,
            ]}
          />
        </div>
      </Panel>

      {text ? <Note tone="info">{text}</Note> : null}

      {points.some((p) => p.accuracy !== null && p.meanCostS !== null) ? (
        <Panel title="Accuracy against time" info="Each point is a strategy. Filled points are the best trade-offs: no other strategy is both more accurate and faster.">
          <div className="space-y-3">
            <FrontierChart points={points} />
            <PointsTable points={points} />
          </div>
        </Panel>
      ) : isRunning ? (
        <Note>Results fill in as answers arrive; the comparison appears once each strategy has answered.</Note>
      ) : null}

      <StrategiesTable run={run} />
      <Paired run={run} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Routing run={run} />
        <Calibration run={run} runId={runId} running={isRunning} />
        <Coupling run={run} />
        <BudgetCurve run={run} />
      </div>
      <Answers run={run} />
    </div>
  );
}
