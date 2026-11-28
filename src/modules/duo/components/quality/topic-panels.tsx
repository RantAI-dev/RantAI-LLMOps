"use client";

import { GwErrorState, Loading, Panel, Pill, arr, fmtInt, fmtMs, fmtPct, rec } from "@/modules/duo/components/duo-ui";
import { TableWrap, Th, domainName, num, tableCls, tdCls, theadCls, trCls } from "@/modules/duo/components/quality/shared";
import type { GwError } from "@/modules/duo/lib/gw";
import { useGw } from "@/modules/duo/lib/gw";

const Of = ({ n }: { n: unknown }) => (num(n) !== null ? <span className="text-[10px] text-ink-faint"> of {fmtInt(n)}</span> : null);

/** Reliability by topic: the self-model (real use only; unknown values are a dash, never zero). */
export function SelfModelPanel({ data, error, onRetry }: { data: Record<string, unknown> | null; error: GwError | null; onRetry: () => void }) {
  if (error && !data) return <GwErrorState error={error} onRetry={onRetry} what="reliability by topic" />;
  if (!data) return <Loading />;
  const D = arr(data.domains);
  const audits = Object.entries(rec(data.audits));
  return (
    <Panel
      title="Reliability by topic"
      info="How often answers are right per topic, from real use only (experiments are kept apart). The best estimate weights checked answers and spot checks so it is not biased towards the questions that happened to be checked."
      actions={
        audits.length ? (
          <span className="text-xs text-ink-soft">
            Spot checks: {audits.map(([k, v]) => `${fmtInt(v)} ${k}`).join(", ")}
          </span>
        ) : undefined
      }
      bodyClassName="p-0"
    >
      {D.length ? (
        <>
          <TableWrap className="rounded-none border-0">
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <Th>Topic</Th>
                  <Th>Answers</Th>
                  <Th tip="Share of answers where the thorough model took over (escalation rate).">Thought longer</Th>
                  <Th tip="Thorough answers that passed an exact check (p2 given escalated).">Thorough right (checked)</Th>
                  <Th tip="Spot-checked thorough answers that were right (p2 given audit).">Thorough right (spot checks)</Th>
                  <Th tip="Best estimate, corrected for which questions were checked (p2_hat), with its margin.">Thorough right (estimate)</Th>
                  <Th tip="Quick answers that a spot check found right (p1 kept, audited).">Quick right (spot checks)</Th>
                  <Th tip="How often the quick answer agreed with a thorough re-answer.">Quick agrees with thorough</Th>
                  <Th tip="Thumbs up / down from people.">Ratings</Th>
                  <Th>Spot checks</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {D.map((d, i) => (
                  <tr key={String(d.domain ?? i)} className={trCls}>
                    <td className={tdCls}>{domainName(d.domain)}</td>
                    <td className={tdCls}>{fmtInt(d.n)}</td>
                    <td className={tdCls}>{fmtPct(d.escalation_rate)}</td>
                    <td className={tdCls}>
                      {fmtPct(d.p2_given_escalated)}
                      <Of n={d.n_escalated_labelled} />
                    </td>
                    <td className={tdCls}>
                      {fmtPct(d.p2_given_audit)}
                      <Of n={d.n_audit_labelled} />
                    </td>
                    <td className={tdCls}>
                      <strong>{fmtPct(d.p2_hat)}</strong>
                      {num(d.p2_se_bound) !== null ? <span className="text-ink-soft"> ±{fmtPct(d.p2_se_bound)}</span> : null}
                    </td>
                    <td className={tdCls}>{fmtPct(d.p1_kept_audited)}</td>
                    <td className={tdCls}>{fmtPct(d.kept_vs_slow_agreement)}</td>
                    <td className={tdCls}>
                      {num(d.human_up) !== null || num(d.human_down) !== null ? `${fmtInt(d.human_up ?? 0)} up / ${fmtInt(d.human_down ?? 0)} down` : "–"}
                    </td>
                    <td className={tdCls}>{fmtInt(d.n_audit)}</td>
                    <td className={tdCls}>{d.status === "measured" ? <Pill tone="good">measured</Pill> : <Pill tone="warn">needs more spot checks</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="px-4 py-2 text-xs text-ink-soft">Unknown values show as a dash, never as zero.</p>
        </>
      ) : (
        <p className="px-4 py-6 text-sm text-ink-soft">No answers from real use yet. Topics appear here once people use Chat.</p>
      )}
    </Panel>
  );
}

/** What people prefer when shown both answers (the value of thinking longer where no exact check exists). */
export function PreferencesPanel() {
  const { data, error, loading, reload } = useGw<Record<string, unknown>>("/v1/preferences");
  if (error && !data) return <GwErrorState error={error} onRetry={() => reload(false)} what="preferences" />;
  if (loading && !data) return <Loading />;
  const P = arr(rec(data).domains);
  return (
    <Panel
      title="What people prefer"
      info="From Compare in Chat: people see the quick and the thorough answer side by side and pick the better one. Ties and 'both poor' are left out of the share."
      bodyClassName="p-0"
    >
      {P.length ? (
        <TableWrap className="rounded-none border-0">
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <Th>Topic</Th>
                <Th>Comparisons</Th>
                <Th tip="Share of decided comparisons where people picked the thorough answer.">Prefer thorough</Th>
                <Th tip="95% interval (Clopper-Pearson).">95% interval</Th>
                <Th>Prefer quick</Th>
                <Th>Same / both poor</Th>
                <Th tip="How much longer the thorough answer took, on average.">Extra wait</Th>
              </tr>
            </thead>
            <tbody>
              {P.map((d, i) => {
                const ci = arr<number>(d.ci95);
                return (
                  <tr key={String(d.domain ?? i)} className={trCls}>
                    <td className={tdCls}>{domainName(d.domain)}</td>
                    <td className={tdCls}>{fmtInt(d.n)}</td>
                    <td className={tdCls}>
                      <strong>{fmtPct(d.slow_preferred_rate)}</strong>
                    </td>
                    <td className={tdCls}>{ci.length === 2 ? `${fmtPct(ci[0])}–${fmtPct(ci[1])}` : "–"}</td>
                    <td className={tdCls}>{fmtInt(d.fast)}</td>
                    <td className={tdCls}>
                      {fmtInt(d.tie)} / {fmtInt(d.both_bad)}
                    </td>
                    <td className={tdCls}>{num(d.mean_extra_ms) !== null ? `+${fmtMs(d.mean_extra_ms)}` : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      ) : (
        <p className="px-4 py-6 text-sm text-ink-soft">
          No comparisons yet. In Chat, choose <strong>Compare</strong> and pick the better answer.
        </p>
      )}
    </Panel>
  );
}
