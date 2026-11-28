"use client";

import { FlaskConical, RotateCw, Square } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { Meter, Panel, Pill, Spinner, arr, fmtAgo, fmtPct, rec, str } from "@/modules/duo/components/duo-ui";
import { canResume, runStatus, sysLabel } from "@/modules/duo/components/experiments/labels";
import { gw } from "@/modules/duo/lib/gw";

export const TH = "whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-ink-soft";
export const TD = "px-3 py-2 align-top";
const MAIN = ["nafs_aql", "nafs_blind", "fast_only", "slow_only"];

export type RawRun = Record<string, unknown>;

/** Cancel or resume a run; returns true when the gateway accepted it. */
export async function runAction(id: string, action: "cancel" | "resume"): Promise<boolean> {
  try {
    const r = await gw<{ kept_items?: number }>(`/v1/eval/runs/${encodeURIComponent(id)}/${action}`, { method: "POST" });
    toast.success(action === "cancel" ? "Stopping after the current question…" : `Resumed; ${r?.kept_items ?? 0} finished answers kept`);
    return true;
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** Every experiment the gateway has, newest first, with its status and the main accuracies. */
export function RunList({
  runs,
  selected,
  onSelect,
  onChanged,
  onResumed,
}: {
  runs: RawRun[];
  selected: string | null;
  onSelect: (id: string) => void;
  onChanged: () => void;
  /** Called after the gateway accepted a resume, so the page can reload the detail and follow the run. */
  onResumed?: (id: string) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  // Runs acted on, with the status they had: their buttons stay disabled until the list shows a new status, so a
  // second click before the reload lands cannot send a second request.
  const [acted, setActed] = useState<Record<string, unknown>>({});
  const inFlight = useRef(new Set<string>());
  const act = async (id: string, a: "cancel" | "resume", status: unknown) => {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    setBusy(id);
    const ok = await runAction(id, a);
    inFlight.current.delete(id);
    setBusy(null);
    if (ok) {
      setActed((m) => ({ ...m, [id]: status }));
      onChanged();
      if (a === "resume") {
        onSelect(id);
        onResumed?.(id);
      }
    }
  };
  const waiting = (r: RawRun) => {
    const id = str(r.run_id, "");
    return busy === id || (id in acted && acted[id] === r.status);
  };
  return (
    <Panel title="Past experiments" info="Click an experiment to see its results. Interrupted or cancelled experiments can be resumed: finished answers are kept." bodyClassName="p-0">
      {runs.length === 0 ? (
        <EmptyState
          icon={FlaskConical}
          title="No experiments yet"
          description="Start with a ready-made experiment, or a small question set (such as smoke_mixed) and 4–6 questions."
          className="m-4"
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                <th className={TH}>When</th>
                <th className={TH}>Question set</th>
                <th className={TH}>Status</th>
                <th className={TH}>Progress</th>
                {MAIN.map((k) => (
                  <th key={k} className={TH}>
                    {sysLabel(k)}
                  </th>
                ))}
                <th className={TH}>Other strategies</th>
                <th className={TH}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const id = str(r.run_id, "");
                const st = runStatus(r.status);
                const prog = rec(r.progress);
                const done = typeof prog.done === "number" ? prog.done : 0;
                const total = typeof prog.total === "number" ? prog.total : 0;
                const sys = rec(r.systems);
                const req = rec(r.request);
                const others = Object.keys(sys).filter((k) => !MAIN.includes(k));
                const reqOthers = others.length ? others : arr<string>(req.systems).filter((k) => typeof k === "string" && !MAIN.includes(k));
                return (
                  <tr
                    key={id}
                    className={cn("cursor-pointer border-t border-hairline hover:bg-surface-2", selected === id && "bg-primary-soft")}
                    onClick={() => onSelect(id)}
                    aria-selected={selected === id}
                  >
                    <td className={cn(TD, "whitespace-nowrap")}>
                      <button
                        type="button"
                        className="text-left font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelect(id);
                        }}
                      >
                        {fmtAgo(r.started_at ?? r.created_at)}
                      </button>
                    </td>
                    <td className={TD}>{str(req.benchmark)}</td>
                    <td className={TD}>
                      <Pill tone={st.tone}>
                        {r.status === "running" ? <Spinner className="size-3" /> : null}
                        {st.label}
                      </Pill>
                    </td>
                    <td className={cn(TD, "min-w-28")}>
                      <span className="text-xs tabular-nums text-ink-soft">
                        {done}/{total || "?"}
                      </span>
                      {r.status === "running" && total ? <Meter value={done / total} label="Progress" /> : null}
                    </td>
                    {MAIN.map((k) => (
                      <td key={k} className={cn(TD, "tabular-nums")}>
                        {sys[k] ? fmtPct(rec(sys[k]).accuracy) : <span className="text-ink-faint">–</span>}
                      </td>
                    ))}
                    <td className={cn(TD, "text-xs text-ink-soft")}>{reqOthers.map(sysLabel).join(", ") || "–"}</td>
                    <td className={cn(TD, "whitespace-nowrap text-right")}>
                      {r.status === "running" ? (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={waiting(r)}
                          onClick={(e) => {
                            e.stopPropagation();
                            void act(id, "cancel", r.status);
                          }}
                        >
                          <Square /> Stop
                        </Button>
                      ) : canResume(r.status) ? (
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={waiting(r)}
                          title="Continue where it stopped"
                          onClick={(e) => {
                            e.stopPropagation();
                            void act(id, "resume", r.status);
                          }}
                        >
                          <RotateCw /> Resume
                        </Button>
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
