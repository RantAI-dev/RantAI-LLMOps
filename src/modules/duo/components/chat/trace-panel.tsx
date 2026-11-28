"use client";

import { BookOpen, Brain, Check, Search, X, Zap } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { CodeBlock, fmtMs, fmtNum, fmtPct, KV, Meter, Pill, rec, str, arr } from "@/modules/duo/components/duo-ui";
import { assuranceOf, STATE_LABEL, type LiveTurn, type Rec } from "@/modules/duo/components/chat/turn";
import { gw } from "@/modules/duo/lib/gw";

const CHECKER: Record<string, string> = {
  math: "Maths check",
  sympy: "Symbolic maths check",
  numeric: "Number check",
  python_tests: "Code tests",
  code: "Code tests",
  json_schema: "Format check",
  schema: "Format check",
  judge: "Rubric review",
  lean: "Proof check",
};
const checkerName = (v: unknown) => CHECKER[str(v, "").toLowerCase()] ?? str(v, "Check");

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-b border-hairline pb-3 last:border-0">
      <h3 className="text-xs font-semibold tracking-wide text-ink-soft uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Gauge({ label, value, tone, hint }: { label: string; value: unknown; tone: "bad" | "good" | "info"; hint?: string }) {
  return (
    <div title={hint}>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-ink-soft">{label}</span>
        <span className="tabular-nums">{fmtPct(value)}</span>
      </div>
      <Meter value={typeof value === "number" ? value : null} tone={tone} label={label} />
    </div>
  );
}

/** What the knowledge base, the memory of earlier chats and the reasoning cache contributed (ChatReply.sources). */
export function SourcesView({ sources }: { sources: Rec[] }) {
  if (!sources.length) return null;
  const notes = sources.filter((x) => x.note && !x.chunk_id);
  const hits = sources.filter((x) => x.chunk_id);
  const facts = sources.flatMap((x) => arr<Rec>(x.facts));
  const support = sources.map((x) => rec(x.support)).find((x) => Object.keys(x).length);
  const recall = sources.flatMap((x) => arr<Rec>(x.recall));
  const arc = sources.map((x) => rec(x.arc)).find((x) => Object.keys(x).length);
  const mem = sources.map((x) => rec(x.memory)).find((x) => Object.keys(x).length);
  return (
    <div className="space-y-2 text-sm">
      {notes.map((n, i) => (
        <p key={`n${i}`} className="flex gap-1.5 text-ink-soft">
          <BookOpen className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {str(n.note)}
        </p>
      ))}
      {arc ? (
        <p className="flex gap-1.5">
          <Zap className="mt-0.5 size-3.5 shrink-0 text-info-strong" aria-hidden />
          Worked out from a stored method: the same problem was thought through before, so its working ran again with this question&apos;s values
          {arc.ms != null ? ` (${fmtMs(arc.ms)})` : ""}.
        </p>
      ) : null}
      {mem ? (
        <p className="text-ink-soft">
          Answered with a memory of the knowledge base: {fmtNum(mem.tokens)} memory tokens from {fmtNum(mem.documents)} passages (experimental).
        </p>
      ) : null}
      {hits.length ? (
        <ol className="space-y-2">
          {hits.map((h, i) => (
            <li key={`h${i}`} id={`duo-src-${str(h.n, String(i + 1))}`} className="rounded-md border border-hairline bg-background p-2">
              <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                <Pill>{str(h.n, String(i + 1))}</Pill>
                <span className="font-medium text-foreground">{str(h.doc_title, "Document")}</span>
                {h.page != null ? <span>· page {str(h.page)}</span> : null}
                {h.heading ? <span className="truncate">· {str(h.heading)}</span> : null}
                {typeof h.score === "number" ? <span className="ml-auto tabular-nums">{fmtNum(h.score, 2)}</span> : null}
              </div>
              <p className="line-clamp-6 text-xs leading-5 whitespace-pre-wrap">{str(h.text, "")}</p>
            </li>
          ))}
        </ol>
      ) : null}
      {facts.length ? (
        <details className="rounded-md border border-hairline p-2">
          <summary className="cursor-pointer text-sm">Used {facts.length} relation{facts.length === 1 ? "" : "s"} from the knowledge graph</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {facts.map((f, i) => (
              <li key={i}>
                <b>{str(f.source)}</b> {str(f.predicate)} <b>{str(f.target)}</b>
                {f.quote ? <div className="text-ink-faint">“{str(f.quote)}”</div> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {support && typeof support.claims === "number" ? (
        arr<Rec>(support.unsupported).length ? (
          <details className="rounded-md border border-warning-border bg-warning-soft p-2">
            <summary className="cursor-pointer text-sm">
              {fmtNum(support.supported)} of {fmtNum(support.claims)} sentences are in the passages; {arr(support.unsupported).length} are not. Check them against the sources.
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
              {arr<Rec>(support.unsupported).map((u, i) => (
                <li key={i}>
                  {str(u.text)} {u.reason ? <span className="text-ink-faint">({str(u.reason)})</span> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="flex gap-1.5 text-success">
            <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Every sentence of this answer is in the passages ({fmtNum(support.claims)} compared word by word; this does not prove the answer right).
          </p>
        )
      ) : null}
      {recall.length ? (
        <details className="rounded-md border border-hairline p-2">
          <summary className="cursor-pointer text-sm">Remembered from earlier chats ({recall.length})</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {recall.map((r, i) => (
              <li key={i}>{str(r.text)}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** "Why this answer": routing, signals, cost, checks, timeline and stages of one turn. */
export function TracePanel({ turn }: { turn: LiveTurn }) {
  const reply = turn.reply ? rec(turn.reply) : null;
  const d = turn.decision ? rec(turn.decision) : reply?.decision ? rec(reply.decision) : null;
  const f = rec(d?.features);
  const usage = rec(reply?.usage);
  const stages = arr<Rec>(usage.stages);
  const [record, setRecord] = useState<unknown>(null);
  const [recordErr, setRecordErr] = useState<string | null>(null);
  const decisionId = str(reply?.decision_id, "");
  const gain = typeof d?.e1_hat === "number" && typeof d?.e2_hat === "number" ? d.e1_hat - d.e2_hat : null;
  const fromCache = d?.rule === "reasoning_cache";
  const a = assuranceOf(reply?.assurance);

  return (
    <div className="space-y-3 text-sm">
      <Section title="Routing">
        {d ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              {fromCache ? (
                <Pill tone="fast">
                  <Zap className="size-3" aria-hidden /> Answered from a stored method
                </Pill>
              ) : d.escalate ? (
                <Pill tone="slow">
                  <Brain className="size-3" aria-hidden /> Thought longer (System 2)
                </Pill>
              ) : (
                <Pill tone="fast">
                  <Zap className="size-3" aria-hidden /> Kept the quick answer (System 1)
                </Pill>
              )}
              {reply ? <Pill tone={a.tone} title={a.hint}>{a.label}</Pill> : null}
              {d.rule ? <Pill title="The rule that decided">{str(d.rule)}</Pill> : null}
            </div>
            {d.explanation ? <p className="text-ink-soft">{typeof d.explanation === "string" ? d.explanation : JSON.stringify(d.explanation)}</p> : null}
            {f.draft_tokens || d.e1_hat != null ? <Gauge label="Chance the quick answer is wrong" value={d.e1_hat} tone="bad" hint="e1_hat: the gate's estimate for System 1's draft" /> : <p className="text-xs text-ink-faint">No quick draft for this question.</p>}
            <Gauge label="Chance after thinking" value={d.e2_hat} tone="good" hint="e2_hat: the estimate for System 2" />
            {gain !== null ? (
              <p className="text-xs text-ink-soft">
                Thinking would cut the chance of a wrong answer by {fmtPct(gain, 1)}; the gate thinks longer when that gain is worth the extra time at speed weight {fmtNum(d.lambda, 2)}.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-ink-faint">Deciding…</p>
        )}
      </Section>

      {d ? (
        <Section title="Signals">
          <KV
            rows={[
              ["Topic", str(f.domain ?? turn.domain ?? reply?.domain)],
              ["Draft confidence", fmtNum(f.mean_logprob, 3)],
              f.min_logprob != null ? ["Least sure token", fmtNum(f.min_logprob, 2)] : null,
              ["Quick samples agree", `${fmtPct(f.agreement)}${f.k != null ? ` (${str(f.k)} samples)` : ""}`],
              ["Checkable", `${f.verifiable ? "yes" : "no"}${f.draft_verified != null ? ` · draft ${f.draft_verified ? "passed" : "failed"}` : ""}`],
              f.draft_tokens != null ? ["Draft length", `${fmtNum(f.draft_tokens)} tokens`] : null,
              d.delta_c != null ? ["Expected extra time", `${fmtNum(d.delta_c, 2)} s`] : null,
              d.calibration_version ? ["Prediction version", str(d.calibration_version)] : null,
            ]}
          />
        </Section>
      ) : null}

      {reply ? (
        <Section title="Cost">
          <KV
            rows={[
              ["Total time", fmtMs(usage.wall_ms)],
              ["First words", fmtMs(usage.ttft_ms)],
              ["Model calls", fmtNum(usage.model_calls)],
              ["Checks run", fmtNum(usage.verifier_calls)],
              ["Tokens", `${fmtNum(usage.prompt_tokens)} read · ${fmtNum(usage.completion_tokens)} written`],
              ["Thinking", `${fmtNum(usage.reasoning_tokens)}${usage.thinking_budget ? ` of ${fmtNum(usage.thinking_budget)}` : ""} tokens`],
              arr(reply.states).length > 0 ? ["Steps", arr<string>(reply.states).map((x) => STATE_LABEL[x]?.label ?? x).join(" → ")] : null,
              d?.backend ? ["Model server", str(d.backend)] : null,
            ]}
          />
          {stages.length ? (
            <div className="space-y-1">
              {stages.map((st, i) => {
                const total = typeof usage.wall_ms === "number" && usage.wall_ms > 0 ? usage.wall_ms : stages.reduce((s, x) => s + (typeof x.ms === "number" ? x.ms : 0), 0) || 1;
                return (
                  <div key={i} className="text-xs" title={str(st.note, "")}>
                    <div className="flex justify-between">
                      <span>{str(st.stage)}</span>
                      <span className="tabular-nums text-ink-soft">
                        {fmtMs(st.ms)}
                        {st.tokens != null ? ` · ${fmtNum(st.tokens)} tok` : ""}
                      </span>
                    </div>
                    <Meter value={(typeof st.ms === "number" ? st.ms : 0) / total} tone="info" label={str(st.stage)} />
                  </div>
                );
              })}
            </div>
          ) : null}
          {decisionId ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={async () => {
                  setRecordErr(null);
                  try {
                    setRecord(await gw(`/v1/decisions/${encodeURIComponent(decisionId)}`));
                  } catch (e) {
                    setRecordErr(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                <Search className="size-3" /> Decision record
              </Button>
              <span className="font-mono text-xs text-ink-faint">{decisionId.slice(0, 8)}…</span>
            </div>
          ) : null}
          {recordErr ? <p className="text-xs text-danger">{recordErr}</p> : null}
          {record ? <CodeBlock>{JSON.stringify(record, null, 2)}</CodeBlock> : null}
        </Section>
      ) : null}

      {turn.verifications.length || reply?.verifier ? (
        <Section title="Checks">
          {(turn.verifications.length ? turn.verifications : [{ kind: "final", result: rec(reply?.verifier) }]).map((v, i) => {
            const r = v.result;
            const rates = rec(r.rates);
            return (
              <div key={i} className="space-y-1">
                <Pill tone={r.passed === true ? "good" : "bad"}>
                  {r.passed === true ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
                  {checkerName(r.verifier)} · {v.kind}
                </Pill>
                {rates.r != null ? (
                  <span className="ml-2 text-xs text-ink-faint" title="How often this check accepts right answers, and how often wrong ones fool it">
                    accepts right {fmtPct(rates.r, 1)} · fooled {fmtPct(rates.phi, 1)}
                  </span>
                ) : null}
                {r.evidence ? <CodeBlock className="max-h-40">{str(r.evidence)}</CodeBlock> : null}
              </div>
            );
          })}
        </Section>
      ) : null}

      {turn.reasoning ? (
        <Section title="System 2 thinking">
          <details>
            <summary className="cursor-pointer text-ink-soft">Show the reasoning ({turn.reasoning.length.toLocaleString()} characters)</summary>
            <CodeBlock className="mt-2 max-h-96">{turn.reasoning}</CodeBlock>
          </details>
        </Section>
      ) : null}

      <Section title="Timeline">
        {turn.events.length ? (
          <ol className="space-y-1 text-xs">
            {turn.events.map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="w-12 shrink-0 text-right tabular-nums text-ink-faint">{(e.t / 1000).toFixed(1)}s</span>
                <span>{e.text}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-ink-faint">Opened from history.</p>
        )}
      </Section>
    </div>
  );
}
