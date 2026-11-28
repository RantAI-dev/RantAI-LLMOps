"use client";

import { ChevronDown, FileSearch, Play } from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { CodeBlock, GwErrorState, KV, Loading, Panel, Pill, Spinner, arr, fmtAgo, fmtInt, fmtMs, fmtNum, fmtPct, rec, str, type Tone } from "@/modules/duo/components/duo-ui";
import { TableWrap, Th, domainName, plain, tableCls, tdCls, theadCls, trCls } from "@/modules/duo/components/quality/shared";
import { GwError, gw, useGw } from "@/modules/duo/lib/gw";

const errMsg = (e: unknown) => (e instanceof GwError ? e.message : e instanceof Error ? e.message : String(e));

const AUDIT_STATUS: Record<string, { tone: Tone; label: string }> = {
  pending: { tone: "info", label: "waiting" },
  done: { tone: "good", label: "done" },
  failed: { tone: "bad", label: "failed" },
  error: { tone: "bad", label: "failed" },
  skipped: { tone: "neutral", label: "skipped" },
};

const Mark = ({ v }: { v: unknown }) =>
  v === true ? (
    <span className="text-success" aria-label="right">
      ✓
    </span>
  ) : v === false ? (
    <span className="text-danger" aria-label="wrong">
      ✗
    </span>
  ) : (
    <span className="text-ink-faint">–</span>
  );

/** Spot checks: a share of quick answers is answered again by the thorough model while the service is idle. */
export function AuditsPanel() {
  const { data, error, loading, reload, setData } = useGw<Record<string, unknown>>("/v1/audits?limit=50", { refreshMs: 20_000 });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [decision, setDecision] = useState<string | null>(null);

  if (error && !data) return <GwErrorState error={error} onRetry={() => reload(false)} what="the spot checks" />;
  if (loading && !data) return <Loading />;
  const A = arr(rec(data).audits);
  const counts = Object.entries(rec(rec(data).counts));
  const worker = rec(rec(data).worker);

  async function runNext() {
    setBusy(true);
    try {
      const r = rec(await gw("/v1/audits/run-next", { method: "POST" }));
      toast.success(r.completed === true ? "Spot check done" : "No spot check waiting");
      if (r.counts) setData((d) => ({ ...rec(d), counts: r.counts }));
      await reload();
    } catch (e) {
      toast.error("The spot check did not run", { description: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Spot checks"
      info="A share of quick answers is queued and answered again by the thorough model when the service is idle. Comparing the two shows how often the quick answer was right, without waiting for people to complain."
      actions={
        <Button size="xs" variant="outline" onClick={runNext} disabled={busy}>
          {busy ? <Spinner className="size-3" /> : <Play />}
          {busy ? "Running" : "Run the next spot check"}
        </Button>
      }
      bodyClassName="p-0"
    >
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs text-ink-soft">
        <span>
          {fmtPct(worker.audit_fraction)} of quick answers are spot-checked
          {worker.enabled === false ? " (the background checker is off)" : worker.idle_only === true ? " when the service is idle" : ""}.
        </span>
        {counts.map(([k, v]) => (
          <Pill key={k} tone={AUDIT_STATUS[k]?.tone ?? "neutral"}>
            {fmtInt(v)} {AUDIT_STATUS[k]?.label ?? k}
          </Pill>
        ))}
      </div>
      {A.length ? (
        <TableWrap className="max-h-[480px] overflow-y-auto rounded-none border-x-0 border-b-0">
          <table className={tableCls}>
            <thead className={cn(theadCls, "sticky top-0 z-10")}>
              <tr>
                <Th>When</Th>
                <Th>Topic</Th>
                <Th>Status</Th>
                <Th tip="Predicted chance that the quick answer was wrong (e1_hat).">Risk</Th>
                <Th>Quick right</Th>
                <Th>Thorough right</Th>
                <Th tip="How much the two answers agree.">Agreement</Th>
                <Th>Time</Th>
                <Th>Quick answer</Th>
                <Th>
                  <span className="sr-only">Details</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {A.map((a, i) => {
                const id = str(a.audit_id, String(i));
                const st = AUDIT_STATUS[str(a.status, "")] ?? { tone: "neutral" as Tone, label: str(a.status) };
                const isOpen = open === id;
                return (
                  <Fragment key={id}>
                    <tr className={trCls}>
                      <td className={cn(tdCls, "whitespace-nowrap")}>{fmtAgo(a.created_at)}</td>
                      <td className={tdCls}>{domainName(a.domain)}</td>
                      <td className={tdCls}>
                        <Pill tone={st.tone}>{st.label}</Pill>
                      </td>
                      <td className={tdCls}>{fmtNum(a.e1_hat, 2)}</td>
                      <td className={tdCls}>
                        <Mark v={a.kept_correct} />
                      </td>
                      <td className={tdCls}>
                        <Mark v={a.slow_correct} />
                      </td>
                      <td className={tdCls}>{fmtPct(a.agreement)}</td>
                      <td className={tdCls}>{fmtMs(a.wall_ms)}</td>
                      <td className={cn(tdCls, "max-w-[280px] truncate text-ink-soft")} title={str(a.kept_preview, "")}>
                        {str(a.kept_preview, "")}
                      </td>
                      <td className={tdCls}>
                        <Button size="icon-xs" variant="ghost" aria-expanded={isOpen} aria-label={isOpen ? "Hide details" : "Show details"} onClick={() => setOpen(isOpen ? null : id)}>
                          <ChevronDown className={cn("transition-transform", !isOpen && "-rotate-90")} />
                        </Button>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr className="bg-surface-2/50">
                        <td colSpan={10} className="px-3 py-3">
                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <p className="mb-1 text-xs font-medium text-ink-soft">Quick answer</p>
                              <CodeBlock>{str(a.kept_preview, "(not stored)")}</CodeBlock>
                            </div>
                            <div>
                              <p className="mb-1 text-xs font-medium text-ink-soft">Thorough re-answer</p>
                              <CodeBlock>{str(a.slow_preview, "(not answered yet)")}</CodeBlock>
                            </div>
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-soft">
                            {a.kept_assurance ? <span>Quick answer was labelled: {str(a.kept_assurance)}</span> : null}
                            {a.judge_v !== null && a.judge_v !== undefined ? <span>Review score {fmtNum(a.judge_v, 2)}</span> : null}
                            {a.completed_at ? <span>Finished {fmtAgo(a.completed_at)}</span> : null}
                            {a.error ? <span className="text-danger">{plain(a.error)}</span> : null}
                            {typeof a.decision_id === "string" && a.decision_id ? (
                              <Button size="xs" variant="outline" onClick={() => setDecision(String(a.decision_id))}>
                                <FileSearch /> How Auto decided
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      ) : (
        <p className="border-t border-hairline px-4 py-6 text-sm text-ink-soft">No spot checks yet. About one in twenty quick answers is queued for one.</p>
      )}
      <DecisionDialog id={decision} onClose={() => setDecision(null)} />
    </Panel>
  );
}

/** The gate's decision record for one answer (/v1/decisions/{id}). */
export function DecisionDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, error, loading, reload } = useGw<Record<string, unknown>>(id ? `/v1/decisions/${encodeURIComponent(id)}` : null);
  const d = rec(data);
  const f = rec(d.features);
  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-primary">How Auto decided</DialogTitle>
          <DialogDescription>The record kept for this answer: what Auto saw in the quick draft and why it kept it or sent it to the thorough model.</DialogDescription>
        </DialogHeader>
        {error ? (
          <GwErrorState error={error} onRetry={() => reload(false)} what="the decision record" />
        ) : loading || !data ? (
          <Loading />
        ) : (
          <div className="space-y-3">
            {d.explanation ? <p className="text-sm">{plain(d.explanation)}</p> : null}
            <KV
              className="text-[13px]"
              rows={[
                ["Decision", d.escalate === true ? <Pill tone="slow">sent to the thorough model</Pill> : <Pill tone="fast">quick answer kept</Pill>],
                ["Chance the quick answer is wrong", <span key="e1" title="e1_hat">{fmtPct(d.e1_hat, 1)}</span>],
                ["Chance the thorough answer is wrong", <span key="e2" title="e2_hat">{fmtPct(d.e2_hat, 1)}</span>],
                ["Price of waiting", <span key="l" title="lambda">{fmtNum(d.lambda, 2)}</span>],
                ["Extra time expected", <span key="dc" title="delta_c">{fmtNum(d.delta_c, 1)} s</span>],
                ["Rule", str(d.rule)],
                ["Topic", domainName(f.domain)],
                ["Quick samples agreed", fmtPct(f.agreement)],
                ["Checkable", f.verifiable === true ? "yes" : f.verifiable === false ? "no" : "–"],
                ["Model server", str(d.backend)],
                ["When", fmtAgo(d.timestamp)],
              ]}
            />
            <details>
              <summary className="cursor-pointer text-xs text-ink-soft">Full record (JSON)</summary>
              <CodeBlock className="mt-2">{JSON.stringify(data, null, 2)}</CodeBlock>
            </details>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
