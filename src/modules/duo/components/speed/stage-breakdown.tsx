"use client";

import { Gauge } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { GwErrorState, Loading, Panel, Segmented, Spinner, arr, fmtInt, fmtMs, fmtNum, fmtPct, rec, str } from "@/modules/duo/components/duo-ui";
import { useGw } from "@/modules/duo/lib/gw";

/** The steps of an answer, in words, with a colour each (the gateway's stage names). */
const STAGE: Record<string, [string, string]> = {
  retrieval: ["Looking up earlier answers", "bg-ink-faint"],
  arc: ["Reasoning cache", "bg-success"],
  draft: ["Quick draft", "bg-info"],
  sample: ["Quick samples", "bg-chart-2"],
  sample_after: ["Quick samples", "bg-chart-2"],
  verify_draft: ["Checking the draft", "bg-purple"],
  rescue: ["Extra quick tries", "bg-chart-3"],
  deliberate_overlap: ["Other tries at the same time", "bg-chart-4"],
  probe_overlap: ["Progress checks of those tries", "bg-chart-5"],
  probe: ["Progress check", "bg-pink"],
  deliberate: ["Thinking (System 2)", "bg-primary"],
  verify: ["Checking", "bg-purple-strong"],
  judge: ["Review", "bg-warning"],
  overhead: ["Other", "bg-surface-3"],
};
export const stageName = (k: string) => STAGE[k]?.[0] ?? k.replace(/_/g, " ");
const stageColor = (k: string) => STAGE[k]?.[1] ?? "bg-chart-1";

type Part = { k: string; v: number };

function StageBar({ parts, label }: { parts: Part[]; label: string }) {
  const total = parts.reduce((a, p) => a + p.v, 0) || 1;
  return (
    <div className="flex h-4 w-full overflow-hidden rounded bg-surface-2" role="img" aria-label={label}>
      {parts
        .filter((p) => p.v > 0)
        .map((p) => (
          <span key={p.k} className={cn("h-full", stageColor(p.k))} style={{ width: `${(p.v / total) * 100}%` }} title={`${stageName(p.k)}: ${fmtPct(p.v)}`} />
        ))}
    </div>
  );
}

const HOURS = [
  { id: "1", label: "1 h" },
  { id: "6", label: "6 h" },
  { id: "24", label: "24 h" },
  { id: "168", label: "7 days" },
] as const;
type Hours = (typeof HOURS)[number]["id"];

/** Where the time of each answer goes (/v1/perf/stages), and how fast the models read and write. */
export function StageBreakdown() {
  const [hours, setHours] = useState<Hours>("24");
  const [lab, setLab] = useState(false);
  const { data, error, loading, reload } = useGw<Record<string, unknown>>(`/v1/perf/stages?hours=${hours}&lab=${lab}`, { refreshMs: 60_000 });
  const v = rec(data);
  const paths = arr(v.paths);
  const engine = arr(v.engine);
  const span = HOURS.find((h) => h.id === hours)?.label ?? `${hours} h`;
  return (
    <Panel
      title="Where the time goes"
      info="The steps of real answers, and how fast the models read the question (prefill) and write the answer (decode). Steps that run at the same time as the draft are left out of the shares."
      actions={
        <>
          {loading && data ? <Spinner /> : null}
          <label className="flex items-center gap-1.5 text-xs text-ink-soft">
            <input type="checkbox" checked={lab} onChange={(e) => setLab(e.target.checked)} className="size-3.5 accent-[var(--color-primary)]" />
            Include experiments
          </label>
          <Segmented<Hours> label="Time window" value={hours} onChange={setHours} options={HOURS.map((h) => ({ id: h.id, label: h.label }))} />
        </>
      }
    >
      {error && !data ? (
        <GwErrorState error={error} onRetry={() => reload(false)} what="the stage timings" />
      ) : loading && !data ? (
        <Loading label="Measuring…" />
      ) : paths.length === 0 ? (
        <EmptyState icon={Gauge} title="No answers to measure yet" description={`Nothing was answered in the last ${span}. Ask something in Chat or run a load test.`} />
      ) : (
        <div className="space-y-5">
          <p className="text-xs text-ink-soft">
            {fmtInt(v.replies)} {lab ? "answers, experiments included," : "real answers"} from the last {span}.
          </p>
          {paths.map((p) => {
            const parts: Part[] = [
              ...arr(p.stages)
                .filter((x) => typeof x.share === "number")
                .map((x) => ({ k: str(x.stage, "?"), v: x.share as number })),
              { k: "overhead", v: typeof p.overhead_share === "number" ? p.overhead_share : 0 },
            ];
            const name = p.mode === "slow" ? "Answers System 2 took over" : "Answers System 1 gave";
            return (
              <div key={str(p.mode)} className="space-y-1.5">
                <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
                  <span className="font-medium text-primary">{name}</span>
                  <span className="text-xs text-ink-soft">
                    {fmtInt(p.replies)} answers · typical {fmtMs(p.wall_p50_ms)} · slowest 5% {fmtMs(p.wall_p95_ms)}
                  </span>
                </div>
                <StageBar parts={parts} label={`${name}: ${parts.map((x) => `${stageName(x.k)} ${fmtPct(x.v)}`).join(", ")}`} />
                <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-soft">
                  {parts
                    .filter((x) => x.v > 0.005)
                    .map((x) => (
                      <li key={x.k} className="flex items-center gap-1">
                        <span className={cn("size-2.5 rounded-sm", stageColor(x.k))} aria-hidden />
                        {stageName(x.k)} {fmtPct(x.v)}
                      </li>
                    ))}
                </ul>
                {arr(p.stages).length ? (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-ink-soft">Times per step</summary>
                    <table className="mt-1 w-full max-w-xl">
                      <thead className="text-ink-soft">
                        <tr>
                          <th className="py-1 pr-3 text-left font-medium">Step</th>
                          <th className="py-1 pr-3 text-left font-medium">Times run</th>
                          <th className="py-1 pr-3 text-left font-medium">Typical</th>
                          <th className="py-1 pr-3 text-left font-medium">Slowest 5%</th>
                          <th className="py-1 text-left font-medium">Share</th>
                        </tr>
                      </thead>
                      <tbody>
                        {arr(p.stages).map((x) => (
                          <tr key={str(x.stage)} className="border-t border-hairline">
                            <td className="py-1 pr-3">{stageName(str(x.stage, "?"))}</td>
                            <td className="py-1 pr-3 tabular-nums">{fmtInt(x.n)}</td>
                            <td className="py-1 pr-3 tabular-nums">{fmtMs(x.p50_ms)}</td>
                            <td className="py-1 pr-3 tabular-nums">{fmtMs(x.p95_ms)}</td>
                            <td className="py-1 tabular-nums">{x.overlaps_draft ? <span className="text-ink-faint">alongside the draft</span> : fmtPct(x.share)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                ) : null}
              </div>
            );
          })}
          {engine.length ? (
            <div className="overflow-x-auto rounded-md border border-hairline">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-xs text-ink-soft">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Model step</th>
                    <th className="px-3 py-2 text-left font-medium">Calls</th>
                    <th className="px-3 py-2 text-left font-medium" title="Tokens of the question read per second">
                      Reading, tokens/s
                    </th>
                    <th className="px-3 py-2 text-left font-medium" title="Tokens of the answer written per second">
                      Writing, tokens/s
                    </th>
                    <th className="px-3 py-2 text-left font-medium" title="Share of the question the model had already read and could reuse">
                      Reused
                    </th>
                    <th className="px-3 py-2 text-left font-medium" title="Slowest 5% of the wait for a free model">
                      Wait
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {engine.map((e) => (
                    <tr key={str(e.stage)} className="border-t border-hairline">
                      <td className="px-3 py-2">{stageName(str(e.stage, "?"))}</td>
                      <td className="px-3 py-2 tabular-nums">{fmtInt(e.calls)}</td>
                      <td className="px-3 py-2 tabular-nums">{fmtNum(e.prefill_tok_s, 0)}</td>
                      <td className="px-3 py-2 tabular-nums">{fmtNum(e.decode_tok_s, 1)}</td>
                      <td className="px-3 py-2 tabular-nums">{fmtPct(e.cache_reuse)}</td>
                      <td className="px-3 py-2 tabular-nums">{fmtMs(e.queue_p95_ms)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}
