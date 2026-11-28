"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { GwErrorState, Loading, Panel, Pill, arr, fmtAgo, str } from "@/modules/duo/components/duo-ui";
import { GATE_NAME, TriPill, plain } from "@/modules/duo/components/quality/shared";
import { useGw } from "@/modules/duo/lib/gw";

/** Release readiness: the roadmap gates G0..G6, each a go / no-go judged from stored measurements, per criterion. */
export function RoadmapPanel() {
  const { data, error, loading, reload } = useGw<Record<string, unknown>>("/v1/gates", { refreshMs: 120_000 });
  const [open, setOpen] = useState<string | null>(null);
  if (error && !data) return <GwErrorState error={error} onRetry={() => reload(false)} what="release readiness" />;
  if (loading && !data) return <Loading label="Judging the milestones from stored measurements…" />;
  const gates = arr(data?.gates);
  const met = gates.filter((g) => g.status === "pass").length;
  return (
    <Panel
      title="Release readiness"
      info="Each milestone is judged from stored measurements: experiments, load tests, the model registry and sign-offs. A milestone is met only when every criterion is met. 'Not yet known' means there is not enough evidence to decide."
      actions={
        <span className="text-xs text-ink-soft">
          {met} of {gates.length} met{data?.evaluated_at ? ` · judged ${fmtAgo(data.evaluated_at)}` : ""}
        </span>
      }
      bodyClassName="p-2"
    >
      {gates.length ? (
        <ol className="space-y-1">
          {gates.map((g, i) => {
            const id = str(g.gate, `G${i}`);
            const crit = arr(g.criteria);
            const isOpen = open === id;
            const passed = crit.filter((c) => c.status === "pass").length;
            return (
              <li key={id} className="rounded-md border border-hairline">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setOpen(isOpen ? null : id)}
                  className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2"
                >
                  <ChevronDown className={cn("size-4 shrink-0 text-ink-faint transition-transform", !isOpen && "-rotate-90")} aria-hidden />
                  <span className="font-mono text-xs text-ink-faint">{id}</span>
                  <span className="min-w-0 flex-1 font-medium" title={str(g.title, "")}>
                    {GATE_NAME[id] ?? plain(g.title)}
                  </span>
                  <span className="text-xs text-ink-soft">
                    {passed}/{crit.length} criteria
                  </span>
                  <TriPill status={g.status} />
                </button>
                {isOpen ? (
                  <ul className="space-y-2 border-t border-hairline px-3 py-2.5">
                    {crit.map((c, j) => (
                      <li key={str(c.id, String(j))} className="flex gap-2 text-[13px]">
                        <span className="shrink-0">
                          <TriPill status={c.status} />
                        </span>
                        <span className="min-w-0">
                          <span className="block" title={str(c.id, "")}>
                            {plain(c.criterion) || str(c.criterion)}
                          </span>
                          {c.evidence ? <span className="block text-xs text-ink-soft">{plain(c.evidence)}</span> : null}
                        </span>
                      </li>
                    ))}
                    {!crit.length ? <li className="text-xs text-ink-soft">No criteria listed.</li> : null}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="px-2 py-4 text-sm text-ink-soft">No milestones reported.</p>
      )}
      {gates.length ? (
        <p className="px-2 pt-2 text-xs text-ink-soft">
          <Pill tone="good">Met</Pill> <Pill tone="bad">Not met</Pill> <Pill tone="warn">Not yet known</Pill>
        </p>
      ) : null}
    </Panel>
  );
}
