"use client";

import { BellRing } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { GwErrorState, Loading, Note, Panel, Pill, arr, fmtInt, fmtMs, fmtNum, fmtPct, rec, str, type Tone } from "@/modules/duo/components/duo-ui";
import { ALERT_NAME, ConfirmDialog, CusumSpark, TableWrap, Th, domainName, num, nums, plain, tableCls, tdCls, theadCls, trCls } from "@/modules/duo/components/quality/shared";
import { GwError, gw, useGw } from "@/modules/duo/lib/gw";

const errMsg = (e: unknown) => (e instanceof GwError ? e.message : e instanceof Error ? e.message : String(e));

const ALERT_STATE: Record<string, { tone: Tone; label: string }> = {
  firing: { tone: "bad", label: "warning" },
  ok: { tone: "good", label: "ok" },
  "insufficient data": { tone: "neutral", label: "not enough data" },
};

function alertValue(rule: string, v: unknown): string {
  if (num(v) === null) return "–";
  if (rule.includes("rate") || rule.includes("acceptance")) return fmtPct(v, 1);
  if (rule === "fast_path_latency") return fmtMs(v);
  if (rule === "calibration_drift") return v ? "alarm" : "steady";
  return fmtNum(v);
}

/** Warnings: the alert rules over the recent window, and a drill that turns them all on to test notifications. */
export function AlertsPanel({ data, error, onRetry, onChanged }: { data: Record<string, unknown> | null; error: GwError | null; onRetry: () => void; onChanged: (d: Record<string, unknown>) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (error && !data) return <GwErrorState error={error} onRetry={onRetry} what="the warnings" />;
  if (!data) return <Loading />;
  const rules = arr(data.rules);
  return (
    <Panel
      title="Warnings"
      info="Early warnings when quality or speed slips, over the recent window. Rules with too few answers say 'not enough data' instead of guessing. The same rules are exported for the monitoring stack."
      actions={
        <>
          <span className="text-xs text-ink-soft">Last {fmtInt(data.window_min)} minutes</span>
          <Button size="xs" variant="outline" onClick={() => setConfirm(true)} disabled={busy} title="For two minutes every warning turns on, to test that notifications arrive">
            <BellRing /> Test warnings
          </Button>
        </>
      }
      bodyClassName="p-0"
    >
      {data.drill === true ? (
        <Note tone="warn" className="m-3">
          Test in progress: every warning shows as on.
        </Note>
      ) : null}
      {rules.length ? (
        <TableWrap className="rounded-none border-0">
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <Th>Warning</Th>
                <Th>Now</Th>
                <Th>Limit</Th>
                <Th tip="Answers in the window the rule is judged on.">Answers</Th>
                <Th>State</Th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r, i) => {
                const id = str(r.rule, "");
                const st = ALERT_STATE[str(r.state, "")] ?? { tone: "neutral" as Tone, label: str(r.state) };
                return (
                  <tr key={id || i} className={trCls}>
                    <td className={tdCls}>
                      <span title={str(r.description, "")}>{ALERT_NAME[id] ?? plain(r.description)}</span>
                    </td>
                    <td className={tdCls}>{alertValue(id, r.value)}</td>
                    <td className={tdCls}>{str(r.threshold)}</td>
                    <td className={tdCls}>{fmtInt(r.n)}</td>
                    <td className={tdCls}>
                      <Pill tone={st.tone}>{st.label}</Pill>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      ) : (
        <p className="px-4 py-6 text-sm text-ink-soft">No warning rules are configured.</p>
      )}
      <ConfirmDialog
        open={confirm}
        title="Test the warnings?"
        confirmLabel="Start the test"
        busy={busy}
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            const d = rec(await gw("/v1/alerts/drill", { method: "POST", body: { seconds: 120 } }));
            const a = rec(d.alerts);
            toast.success(`Test: ${fmtInt(a.firing)} warnings on for ${fmtInt(d.drill_seconds)} s`);
            if (Object.keys(a).length) onChanged(a);
            setConfirm(false);
          } catch (e) {
            toast.error("The test did not start", { description: errMsg(e) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          For two minutes every warning turns on, so you can check that notifications reach the people on call. Anyone watching the monitoring will see the warnings;
          let them know first.
        </p>
      </ConfirmDialog>
    </Panel>
  );
}

function DriftCell({ c, h, label }: { c: Record<string, unknown>; h: number; label: string }) {
  if (num(c.n) === null || c.alarm === null || c.alarm === undefined) {
    const note = str(c.note, "no data").replace(/needs >= (\d+) labelled observations \(has (\d+)\)/, "needs $1 checked answers (has $2)");
    return <span className="text-xs text-ink-faint">{plain(note)}</span>;
  }
  const dir = str(c.direction, "");
  return (
    <span className="flex flex-wrap items-center gap-2">
      <CusumSpark hi={nums(c.s_hi)} lo={nums(c.s_lo)} h={h} label={label} />
      {c.alarm === true ? <Pill tone="bad">changed{dir === "up" ? " (worse)" : dir === "down" ? " (lower)" : ""}</Pill> : <Pill tone="good">steady</Pill>}
      {c.negative_control_alarm === true ? (
        <Pill tone="warn" title="The same alarm also appears with the order shuffled, so it may be noise">
          may be noise
        </Pill>
      ) : null}
    </span>
  );
}

/** Is quality changing? Two-sided CUSUM charts per topic: a lasting change, not one bad answer. */
export function DriftPanel() {
  const { data, error, loading, reload } = useGw<Record<string, unknown>>("/v1/drift", { refreshMs: 60_000 });
  if (error && !data) return <GwErrorState error={error} onRetry={() => reload(false)} what="the drift charts" />;
  if (loading && !data) return <Loading />;
  const D = arr(rec(data).domains);
  const h = num(rec(rec(data).params).h) ?? 10;
  return (
    <Panel
      title="Is quality changing?"
      info="Each chart adds up how far recent answers sit from the usual level (a two-sided CUSUM). It flags a lasting change, not a single bad answer. The dashed line is the alarm level; the darker line tracks getting worse, the lighter one getting better. A shuffled-order control flags alarms that may be noise."
      bodyClassName="p-0"
    >
      {D.length ? (
        <TableWrap className="rounded-none border-0">
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <Th>Topic</Th>
                <Th tip="Checked answers the charts are built from.">Answers</Th>
                <Th tip="Whether the predicted chance of a wrong quick answer still matches reality (calibration error).">Mistake prediction</Th>
                <Th tip="Share of quick answers that pass their check (fast-path accuracy).">Quick answers right</Th>
              </tr>
            </thead>
            <tbody>
              {D.map((d, i) => {
                const ce = rec(d.calibration_error);
                const acc = rec(d.accuracy);
                const name = domainName(d.domain);
                return (
                  <tr key={String(d.domain ?? i)} className={trCls}>
                    <td className={tdCls}>{name}</td>
                    <td className={tdCls}>{fmtInt(ce.n)}</td>
                    <td className={tdCls}>
                      <DriftCell c={ce} h={h} label={`Mistake prediction drift, ${name}`} />
                    </td>
                    <td className={tdCls}>
                      <DriftCell c={acc} h={h} label={`Quick answer accuracy drift, ${name}`} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      ) : (
        <p className="px-4 py-6 text-sm text-ink-soft">No checked answers yet. The charts start once about 20 checked answers exist.</p>
      )}
    </Panel>
  );
}
