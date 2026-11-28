"use client";

import { Activity as ActivityIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { GwErrorState, Loading, Panel, Pill, Segmented, Spinner, Stat, StatGrid, arr, fmtAgo, fmtMs, fmtPct, str } from "@/modules/duo/components/duo-ui";
import { assuranceInfo, modeInfo, ruleName } from "@/modules/duo/components/status/words";
import { useGw } from "@/modules/duo/lib/gw";

const TH = "whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-ink-soft";
const TD = "px-3 py-2";
const PAGE = 50;
export const ACTIVITY_REFRESH_MS = 10_000;

type Filter = "all" | "fast" | "slow";

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

/** The latest replies (/v1/system/activity): how each was answered, how sure it is, and how long it took. */
export function Activity() {
  const { data, error, loading, reload } = useGw<unknown[]>("/v1/system/activity", { refreshMs: ACTIVITY_REFRESH_MS });
  const [filter, setFilter] = useState<Filter>("all");
  const [limit, setLimit] = useState(PAGE);
  const all = useMemo(() => arr(data), [data]);
  const rows = all.filter((r) => filter === "all" || r.mode === filter);
  const walls = all.map((r) => r.wall_ms).filter((x): x is number => typeof x === "number");
  const slow = all.filter((r) => r.mode === "slow").length;
  const checked = all.filter((r) => r.assurance === "verified").length;
  return (
    <Panel
      title="Recent activity"
      info={`The latest answers, newest first. Refreshes every ${ACTIVITY_REFRESH_MS / 1000} seconds.`}
      actions={
        <>
          {loading && data ? <Spinner /> : null}
          {all.length ? (
            <Segmented<Filter>
              label="Show answers"
              value={filter}
              onChange={(f) => {
                setFilter(f);
                setLimit(PAGE);
              }}
              options={[
                { id: "all", label: "All" },
                { id: "fast", label: "System 1" },
                { id: "slow", label: "System 2" },
              ]}
            />
          ) : null}
        </>
      }
    >
      {error && !data ? (
        <GwErrorState error={error} onRetry={() => reload(false)} what="the recent activity" />
      ) : loading && !data ? (
        <Loading label="Loading recent answers…" />
      ) : all.length === 0 ? (
        <EmptyState icon={ActivityIcon} title="No answers yet" description="Answers appear here as soon as someone asks a question in Chat." />
      ) : (
        <div className="space-y-3">
          <StatGrid>
            <Stat label="Answers shown" value={all.length.toLocaleString()} hint={`newest ${fmtAgo(all[0]?.created_at)}`} />
            <Stat label="System 2 took over" value={fmtPct(slow / all.length)} hint={`${slow} answers`} />
            <Stat label="Typical answer time" value={fmtMs(median(walls))} />
            <Stat label="Checked exactly" value={fmtPct(checked / all.length)} hint={`${checked} answers`} />
          </StatGrid>
          <div className="overflow-x-auto rounded-md border border-hairline">
            <table className="w-full text-sm">
              <thead className="bg-surface-2">
                <tr>
                  {["When", "Topic", "Answered by", "How sure", "Time", "First words", "Gate rule", "Engine"].map((h) => (
                    <th key={h} className={TH}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, limit).map((r, i) => {
                  const m = modeInfo(r.mode);
                  const a = assuranceInfo(r.assurance);
                  return (
                    <tr key={`${str(r.created_at, "")}-${i}`} className="border-t border-hairline">
                      <td className={cn(TD, "whitespace-nowrap text-ink-soft")} title={str(r.created_at, "")}>
                        {fmtAgo(r.created_at)}
                      </td>
                      <td className={TD}>{str(r.domain)}</td>
                      <td className={TD}>
                        <Pill tone={m.tone} title={m.hint}>
                          {m.label}
                        </Pill>
                      </td>
                      <td className={TD}>
                        <Pill tone={a.tone} title={a.hint}>
                          {a.label}
                        </Pill>
                      </td>
                      <td className={cn(TD, "tabular-nums")}>{fmtMs(r.wall_ms)}</td>
                      <td className={cn(TD, "tabular-nums")}>{fmtMs(r.ttft_ms)}</td>
                      <td className={cn(TD, "text-xs text-ink-soft")}>{r.rule ? ruleName(r.rule) : "–"}</td>
                      <td className={cn(TD, "text-xs text-ink-soft")}>{str(r.backend)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 ? <p className="px-4 py-6 text-sm text-ink-soft">No answers of this kind among the latest {all.length}.</p> : null}
            {rows.length > limit ? (
              <div className="flex items-center justify-center gap-2 border-t border-hairline p-2 text-xs text-ink-soft">
                Showing {limit} of {rows.length}.
                <Button size="xs" variant="outline" onClick={() => setLimit((l) => l + PAGE)}>
                  Show more
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </Panel>
  );
}
