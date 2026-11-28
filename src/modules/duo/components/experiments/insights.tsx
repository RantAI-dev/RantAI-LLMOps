"use client";

import { Map as MapIcon } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { GwErrorState, Loading, Panel, Pill, arr, fmtInt, fmtNum, fmtPct, rec, str, type Tone } from "@/modules/duo/components/duo-ui";
import { TD, TH } from "@/modules/duo/components/experiments/run-list";
import { useGw } from "@/modules/duo/lib/gw";

/** The pooled policies (nafs-eval insights): which way of answering, in words. */
export const POLICY: Record<string, { label: string; tone: Tone; hint: string }> = {
  fast: { label: "System 1 only", tone: "fast", hint: "always answer at once" },
  gated: { label: "Gate with checks", tone: "good", hint: "check the draft, then decide" },
  blind: { label: "Gate, estimate only", tone: "info", hint: "decide from an estimate" },
  slow: { label: "System 2 always", tone: "slow", hint: "always think first" },
};
const policy = (p: unknown) => POLICY[str(p, "")] ?? { label: str(p), tone: "neutral" as Tone, hint: "" };
const signedPts = (x: unknown) => (typeof x === "number" ? `${x >= 0 ? "+" : ""}${(x * 100).toFixed(0)} pts` : "–");

/**
 * "Which strategy wins?": every experiment pooled per topic (/v1/lab/insights). Each cell is the strategy with the
 * lowest expected loss when a minute saved is worth the column's speed weight against one wrong answer.
 */
export function Insights() {
  const { data, error, loading, reload } = useGw<Record<string, unknown>>("/v1/lab/insights");
  if (loading && !data) return <Loading label="Summarising all experiments…" />;
  if (error) return <GwErrorState error={error} onRetry={() => reload(false)} what="the summary of all experiments" />;
  const ins = rec(data);
  const grid = arr<number>(ins.lambda_grid).filter((l) => typeof l === "number");
  const domains = arr(ins.domains);
  return (
    <Panel
      title="Which strategy wins?"
      info="From every experiment, pooled per topic. Each cell is the best strategy for that topic when speed matters as much as the column says: left, accuracy first; right, speed first."
      actions={<span className="text-xs text-ink-soft">From {fmtInt(ins.runs ?? 0)} experiments</span>}
      bodyClassName={domains.length ? "p-0" : undefined}
    >
      {domains.length === 0 ? (
        <EmptyState
          icon={MapIcon}
          title="No experiments to pool yet"
          description="Run 'Speed against care' or 'Full service' to fill in this map; it needs System 1 only and System 2 always on the same questions."
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2">
                <tr>
                  <th className={TH}>Topic</th>
                  {grid.map((l) => (
                    <th key={l} className={TH} title="Speed weight: the value of one minute saved, against one wrong answer">
                      Speed {fmtNum(l, 2)}
                    </th>
                  ))}
                  <th className={TH} title="How much more often System 2 answers are right than System 1 answers on the same questions, with a 95% interval">
                    System 2 gain
                  </th>
                  <th className={TH} title="In side-by-side trials in Chat, how often people preferred the System 2 answer">
                    People prefer System 2
                  </th>
                </tr>
              </thead>
              <tbody>
                {domains.map((d) => {
                  const map = arr(d.policy_map);
                  const v = d.value_of_deliberation ? rec(d.value_of_deliberation) : null;
                  const hp = rec(d.human_preference);
                  const hs = typeof hp.slow === "number" ? hp.slow : 0;
                  const hf = typeof hp.fast === "number" ? hp.fast : 0;
                  const c = arr<number>(v?.ci95);
                  return (
                    <tr key={str(d.domain)} className="border-t border-hairline">
                      <td className={cn(TD, "min-w-52")}>
                        <p className="font-medium text-primary">{str(d.domain)}</p>
                        <table className="mt-1 text-xs text-ink-soft">
                          <tbody>
                            {arr(d.policies).map((p) => (
                              <tr key={str(p.policy)}>
                                <td className="pr-2">{policy(p.policy).label}</td>
                                <td className="pr-2 tabular-nums">{fmtPct(p.accuracy)}</td>
                                <td className="pr-2 tabular-nums">{fmtNum(p.mean_cost_s, 0)} s</td>
                                <td className="text-ink-faint tabular-nums">{fmtInt(p.n ?? 0)} q</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                      {grid.map((l) => {
                        const b = map.find((x) => typeof x.lambda === "number" && Math.abs(x.lambda - l) < 1e-4);
                        if (!b) return <td key={l} className={cn(TD, "text-ink-faint")}>–</td>;
                        const p = policy(b.policy);
                        const low = b.confidence === "low";
                        return (
                          <td key={l} className={TD}>
                            <Pill tone={p.tone} title={`${p.hint} · ${fmtInt(b.n ?? 0)} questions · ${str(b.confidence)} confidence`}>
                              {p.label}
                              {low ? <span aria-label="low confidence"> ?</span> : null}
                            </Pill>
                          </td>
                        );
                      })}
                      <td className={cn(TD, "text-xs")}>
                        {v ? (
                          <>
                            <strong>{signedPts(v.delta_accuracy)}</strong>
                            {c.length === 2 ? ` [${(c[0] * 100).toFixed(0)}, ${(c[1] * 100).toFixed(0)}]` : ""} for +{fmtNum(v.extra_cost_s, 0)} s{" "}
                            <span className="text-ink-faint">({fmtInt(v.pairs)} pairs)</span>
                          </>
                        ) : (
                          <span className="text-ink-faint">needs System 1 only and System 2 always on the same questions</span>
                        )}
                      </td>
                      <td className={cn(TD, "text-xs")}>
                        {hs + hf ? `${fmtPct(hs / (hs + hf))} of ${hs + hf}` : <span className="text-ink-faint">no trials yet</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-xs text-ink-soft">&quot;?&quot; marks low confidence (fewer than 30 questions). Run more experiments to firm up the map.</p>
        </>
      )}
    </Panel>
  );
}
