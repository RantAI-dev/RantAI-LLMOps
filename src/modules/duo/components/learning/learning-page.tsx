"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { CodeBlock, GwErrorState, KV, Loading, Meter, Note, PageIntro, Panel, Pill, Stat, StatGrid, arr, fmtInt, fmtPct, rec, str } from "@/modules/duo/components/duo-ui";
import { ReviewQueue } from "@/modules/duo/components/learning/review-queue";
import { Fold, TableWrap, Th, domainName, num, plain, tableCls, tdCls, theadCls, trCls } from "@/modules/duo/components/quality/shared";
import { useGw } from "@/modules/duo/lib/gw";

type Obj = Record<string, unknown>;

/** Training starts to pay off at about this many checked examples; no topic may give more than this share. */
export const TARGET_EXAMPLES = 5000;
export const MAX_TOPIC_SHARE = 0.3;

export type Readiness = {
  domain: string;
  ready: number;
  verifiedSlow: number;
  verifiedFast: number;
  approved: number;
  pending: number;
  abstained: number;
  replies: number;
  share: number | null;
  overCap: boolean;
};

/** Per topic: the examples the training set can use now (checked thorough answers and approved agreed answers), and the share of all of them. */
export function readiness(ledger: Obj): { rows: Readiness[]; total: number } {
  const n = (v: unknown) => num(v) ?? 0;
  const base = arr(ledger.domains).map((d) => ({
    domain: str(d.domain, "other"),
    verifiedSlow: n(d.verified_slow),
    verifiedFast: n(d.verified_fast),
    approved: n(d.consensus_approved),
    pending: n(d.consensus_pending),
    abstained: n(d.abstained),
    replies: n(d.replies),
    ready: n(d.verified_slow) + n(d.consensus_approved),
  }));
  const total = base.reduce((a, d) => a + d.ready, 0);
  const rows = base
    .map((d) => {
      const share = total ? d.ready / total : null;
      // One topic alone is not "over the cap": the cap only bites once there is a mix.
      return { ...d, share, overCap: share !== null && share > MAX_TOPIC_SHARE && base.filter((x) => x.ready > 0).length > 1 };
    })
    .sort((a, b) => b.ready - a.ready || b.replies - a.replies);
  return { rows, total };
}

const STEPS: Array<{ title: string; text: string; cmd: string }> = [
  {
    title: "Collect the examples",
    text: "Checked answers only, no duplicates, at most 30% from one topic, personal details removed.",
    cmd: "python3 training/tazkiya.py build --out data/tazkiya/",
  },
  {
    title: "Add generated examples (optional)",
    text: "The thorough model answers practice questions, and only answers that pass a check are kept.",
    cmd: "python3 training/tazkiya.py synthesize --n 200",
  },
  {
    title: "Train on a computer with a graphics card",
    text: "Then export the model files. In LLMOps you can use Fine-tune for this step.",
    cmd: "python3 training/train_unsloth.py --data data/tazkiya/train.jsonl --base Qwen/Qwen3-1.7B",
  },
  {
    title: "Prove the new model",
    text: "On the fixed 500-question test, against the current one, with a person's sign-off.",
    cmd: 'python3 training/tazkiya.py promote --candidate-run RUN --baseline-run RUN --sign-off "name"',
  },
  { title: "Undo", text: "One command puts the previous model back if needed.", cmd: "python3 training/tazkiya.py rollback" },
];

function ReadinessPanel({ ledger, retention }: { ledger: Obj; retention: unknown }) {
  const { rows, total } = readiness(ledger);
  const tot = (k: keyof Readiness) => rows.reduce((a, d) => a + (d[k] as number), 0);
  return (
    <Panel
      title="Examples collected so far"
      info="Only thorough answers that passed an exact check, and agreed answers a person approved, become training examples. The quick-model update starts to pay off at about 5,000 of them. No topic may give more than 30% of the set, so a topic above that line is partly left out."
      actions={<span className="text-xs text-ink-soft">From real chats{num(retention) ? `; kept for ${fmtInt(retention)} days` : ""}</span>}
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span>
              <strong className="text-lg tabular-nums text-primary">{fmtInt(total)}</strong> of about {fmtInt(TARGET_EXAMPLES)} examples ready
            </span>
            <span className="text-xs text-ink-soft">{fmtPct(Math.min(1, total / TARGET_EXAMPLES))}</span>
          </div>
          <Meter value={total / TARGET_EXAMPLES} tone={total >= TARGET_EXAMPLES ? "good" : "info"} label="Training examples ready, toward the target" />
        </div>
        {rows.length ? (
          <TableWrap>
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <Th>Topic</Th>
                  <Th tip="Thorough answers that passed an exact check plus agreed answers a person approved.">Ready</Th>
                  <Th tip="This topic's share of the ready examples; the line marks the 30% cap.">Share of the set</Th>
                  <Th tip="Thorough answers that passed a check: the main examples.">Checked thorough</Th>
                  <Th tip="Quick answers that passed a check.">Checked quick</Th>
                  <Th tip="Agreed answers a person approved.">Approved</Th>
                  <Th tip="Agreed answers waiting for review.">Waiting</Th>
                  <Th tip="Questions where no answer was certain enough; a few of these teach the model to say it is not sure.">Declined</Th>
                  <Th>Answers</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.domain} className={trCls}>
                    <td className={tdCls}>{domainName(d.domain)}</td>
                    <td className={tdCls}>
                      <strong>{fmtInt(d.ready)}</strong>
                    </td>
                    <td className={cn(tdCls, "min-w-[140px]")}>
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Meter value={d.share} tone={d.overCap ? "warn" : "info"} label={`${domainName(d.domain)} share of the set`} />
                          <span className="absolute -top-0.5 h-3 w-px bg-ink-faint" style={{ left: `${MAX_TOPIC_SHARE * 100}%` }} aria-hidden />
                        </div>
                        <span className={cn("w-9 text-right tabular-nums", d.overCap && "text-warning-strong")}>{fmtPct(d.share)}</span>
                      </div>
                      {d.overCap ? <span className="text-[10px] text-warning-strong">above 30%: only part is used</span> : null}
                    </td>
                    <td className={tdCls}>{fmtInt(d.verifiedSlow)}</td>
                    <td className={tdCls}>{fmtInt(d.verifiedFast)}</td>
                    <td className={tdCls}>{fmtInt(d.approved)}</td>
                    <td className={tdCls}>{d.pending ? <Pill tone="info">{fmtInt(d.pending)}</Pill> : "0"}</td>
                    <td className={tdCls}>{fmtInt(d.abstained)}</td>
                    <td className={tdCls}>{fmtInt(d.replies)}</td>
                  </tr>
                ))}
                <tr className={cn(trCls, "font-semibold")}>
                  <td className={tdCls}>Total</td>
                  <td className={tdCls}>{fmtInt(total)}</td>
                  <td className={tdCls} />
                  <td className={tdCls}>{fmtInt(tot("verifiedSlow"))}</td>
                  <td className={tdCls}>{fmtInt(tot("verifiedFast"))}</td>
                  <td className={tdCls}>{fmtInt(tot("approved"))}</td>
                  <td className={tdCls}>{fmtInt(tot("pending"))}</td>
                  <td className={tdCls}>{fmtInt(tot("abstained"))}</td>
                  <td className={tdCls}>{fmtInt(tot("replies"))}</td>
                </tr>
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <p className="text-sm text-ink-soft">No live conversations yet. Examples appear here as people use Chat.</p>
        )}
      </div>
    </Panel>
  );
}

function ModelsPanel({ active, registry }: { active: Obj; registry: Obj }) {
  const hist = arr(registry.history).slice(-8).reverse();
  const adapter = str(rec(rec(registry.active).system1).adapter_hash, "") || (active.adapter_hash !== "none" ? str(active.adapter_hash, "") : "");
  return (
    <Panel title="Models in use" info="Every replacement and undo is recorded in the model registry, with who signed it off.">
      <KV
        className="text-[13px]"
        rows={[
          ["Quick model (System 1)", <span key="s1" className="break-all font-mono text-xs">{str(active.system1)}</span>],
          ["Thorough model (System 2)", <span key="s2" className="break-all font-mono text-xs">{str(active.system2)}</span>],
          ["Learned update", adapter ? <span className="break-all font-mono text-xs">{adapter}</span> : <span className="text-ink-soft">none yet</span>],
        ]}
      />
      {hist.length ? (
        <TableWrap className="mt-3">
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <Th>When</Th>
                <Th>Model</Th>
                <Th>File</Th>
                <Th>Decision</Th>
              </tr>
            </thead>
            <tbody>
              {hist.map((h, i) => (
                <tr key={i} className={trCls}>
                  <td className={cn(tdCls, "whitespace-nowrap")}>{str(h.at, "").slice(0, 16).replace("T", " ") || "–"}</td>
                  <td className={tdCls}>{h.role === "system1" ? "Quick" : h.role === "system2" ? "Thorough" : str(h.role)}</td>
                  <td className={cn(tdCls, "max-w-[160px] truncate font-mono text-[10px]")} title={str(h.gguf ?? h.adapter_hash, "")}>
                    {str(h.gguf ?? h.adapter_hash, "")}
                  </td>
                  <td className={tdCls}>
                    {str(h.action)}
                    {h.signed_off_by ? <span className="text-ink-soft"> · {str(h.signed_off_by)}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : (
        <p className="mt-3 text-xs text-ink-soft">No changes yet: the original models are in use. Every replacement and undo is listed here.</p>
      )}
    </Panel>
  );
}

export function LearningPage() {
  const { data, error, loading, reload } = useGw<Obj>("/v1/tazkiya", { refreshMs: 30_000 });
  const t = rec(data);
  const ledger = rec(t.ledger);
  const fb = rec(ledger.feedback);
  const rv = rec(ledger.reviews);
  const pendingReview = arr(ledger.domains).reduce((a, d) => a + (num(d.consensus_pending) ?? 0), 0);
  const rules = Object.entries(rec(t.rules));

  return (
    <div className="space-y-4 pb-6">
      <PageIntro title="How the quick model improves">
        Thorough answers that passed an exact check become examples the quick model learns from, so more questions can be answered quickly and correctly. Review agreed
        answers, watch the examples grow, and replace a model only after it proves itself.
      </PageIntro>

      {error && !data ? (
        <GwErrorState error={error} onRetry={() => reload(false)} what="the learning summary" />
      ) : loading && !data ? (
        <Loading />
      ) : (
        <>
          <StatGrid>
            <Stat label="Waiting for review" value={fmtInt(pendingReview)} hint="agreed answers" tone={pendingReview ? "info" : undefined} />
            <Stat label="Reviews" value={`${fmtInt(rv.approved ?? 0)} / ${fmtInt(rv.rejected ?? 0)}`} hint="approved / rejected" />
            <Stat label="Ratings" value={`${fmtInt(fb.up ?? 0)} / ${fmtInt(fb.down ?? 0)}`} hint="thumbs up / down" />
            <Stat label="Chats left out" value={fmtInt(ledger.opted_out_conversations ?? 0)} hint={`marked "Don't use to improve answers"`} />
          </StatGrid>

          {rules.length ? (
            <Panel title="What the quick model learns from">
              <p className="text-sm text-ink-soft">
                Training happens on a separate computer with a graphics card, never on the gateway. A new model replaces the current one only after it does at least as
                well on a fixed test, with a one-command way back.
              </p>
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Rules for training data">
                {rules.map(([k, v]) => (
                  <li key={k}>
                    <Pill tone="good" title={k}>
                      <Check className="size-3" aria-hidden />
                      {plain(v)}
                    </Pill>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          <div className="grid gap-3 xl:grid-cols-[2fr_1fr]">
            <ReadinessPanel ledger={ledger} retention={t.retention_days} />
            <ModelsPanel active={rec(t.active_models)} registry={rec(t.registry)} />
          </div>
        </>
      )}

      <ReviewQueue onReviewed={() => void reload()} />

      <Fold title="For operators: how to train and replace a model" summary="Commands run from the gateway's project folder; each step records what it produced.">
        <ol className="space-y-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="space-y-1 text-sm">
              <p>
                <strong>
                  {i + 1}. {s.title}
                </strong>{" "}
                <span className="text-ink-soft">{s.text}</span>
              </p>
              <CodeBlock>{s.cmd}</CodeBlock>
            </li>
          ))}
        </ol>
        <Note className="mt-3">Fewer than about {fmtInt(TARGET_EXAMPLES)} examples rarely improves the model; keep collecting until the bar above is full.</Note>
      </Fold>
    </div>
  );
}
