"use client";

import { Check, Play, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CodeBlock,
  ConfirmButton,
  GwErrorState,
  Loading,
  Meter,
  Note,
  Panel,
  Pill,
  Segmented,
  Spinner,
  arr,
  fmtAgo,
  fmtInt,
  fmtMs,
  fmtNum,
  fmtPct,
  rec,
  str,
} from "@/modules/duo/components/duo-ui";
import { ConfirmDialog, Fold, TableWrap, Th, checkerName, num, plain, tableCls, tdCls, theadCls, trCls } from "@/modules/duo/components/quality/shared";
import { GwError, gw, useGw } from "@/modules/duo/lib/gw";

const errMsg = (e: unknown) => (e instanceof GwError ? e.message : e instanceof Error ? e.message : String(e));

type Suite = "base" | "plus" | "judge";
const SUITES: Array<{ id: Suite; label: string; hint: string }> = [
  { id: "base", label: "Standard tests", hint: "MBPP and HumanEval tests" },
  { id: "plus", label: "Extended tests", hint: "The EvalPlus variants: far stronger tests, so they catch more broken code" },
  { id: "judge", label: "Review only", hint: "Measure only the review by the thorough model" },
];
const RUN_STATUS: Record<string, { tone: "good" | "warn" | "bad" | "info" | "neutral"; label: string }> = {
  running: { tone: "info", label: "measuring" },
  done: { tone: "good", label: "done" },
  failed: { tone: "bad", label: "failed" },
  cancelled: { tone: "neutral", label: "cancelled" },
};
const STAGE: Record<string, string> = { "exact verifiers": "the exact checks", judge: "the review" };

/** How good the checks are: the measured (r, phi) per check, and measurement runs. */
export function VerifierRatesPanel({ rates, ratesError, onRates }: { rates: Record<string, unknown> | null; ratesError: GwError | null; onRates: () => void }) {
  const [poll, setPoll] = useState(20_000);
  const runs = useGw<unknown[]>("/v1/verifiers/runs", { refreshMs: poll });
  const list = arr(runs.data);
  const running = list.find((r) => r.status === "running") ?? null;
  const [suite, setSuite] = useState<Suite>("base");
  const [withReview, setWithReview] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  // Poll fast while a run is going; when it ends, reload the rates it produced.
  const wasRunning = useRef(false);
  const onRatesRef = useRef(onRates);
  useEffect(() => {
    onRatesRef.current = onRates;
  }, [onRates]);
  const isRunning = Boolean(running);
  const wantPoll = isRunning ? 4000 : 20_000;
  if (wantPoll !== poll) setPoll(wantPoll);
  useEffect(() => {
    if (wasRunning.current && !isRunning) onRatesRef.current();
    wasRunning.current = isRunning;
  }, [isRunning]);

  const R = Object.entries(rec(rates?.rates));

  async function start() {
    setBusy(true);
    try {
      await gw("/v1/verifiers/runs", {
        method: "POST",
        body: {
          include_judge: withReview || suite === "judge",
          judge_only: suite === "judge",
          items_per_dataset: 210,
          code_datasets: suite === "plus" ? ["mbpp_plus", "humaneval_plus"] : ["mbpp", "humaneval"],
        },
      });
      toast.success("Measuring the checks…");
      setConfirm(false);
      void runs.reload();
    } catch (e) {
      toast.error("The measurement did not start", { description: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  const prog = rec(running?.progress);
  const done = num(prog.done) ?? 0;
  const total = num(prog.total) ?? 0;

  return (
    <Panel
      title="How good the checks are"
      info="Each check is tried on known-correct answers and on deliberately broken ones. 'Accepts right answers' is r; 'Fooled by wrong answers' is phi. Targets: fooled at most 1% of the time for code and maths, never for formats."
      bodyClassName="p-0"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="rates-suite">
            Tests used for the broken answers
          </label>
          <select
            id="rates-suite"
            value={suite}
            onChange={(e) => setSuite(e.target.value as Suite)}
            disabled={Boolean(running)}
            className="h-7 rounded-md border border-hairline bg-background px-2 text-xs"
          >
            {SUITES.map((s) => (
              <option key={s.id} value={s.id} title={s.hint}>
                {s.label}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
            <input type="checkbox" checked={withReview || suite === "judge"} disabled={suite === "judge" || Boolean(running)} onChange={(e) => setWithReview(e.target.checked)} />
            include review
          </label>
          <Button size="xs" onClick={() => setConfirm(true)} disabled={Boolean(running) || busy}>
            {running ? <Spinner className="size-3" /> : <Play />}
            {running ? "Measuring" : "Measure"}
          </Button>
        </div>
      }
    >
      {ratesError && !rates ? (
        <div className="p-4">
          <GwErrorState error={ratesError} onRetry={onRates} what="the check rates" />
        </div>
      ) : !rates ? (
        <div className="px-4">
          <Loading />
        </div>
      ) : R.length ? (
        <TableWrap className="rounded-none border-0">
          <table className={tableCls}>
            <thead className={theadCls}>
              <tr>
                <Th>Check</Th>
                <Th tip="Share of known-correct answers it accepts (r).">Accepts right answers</Th>
                <Th tip="Share of deliberately broken answers it wrongly accepts (phi).">Fooled by wrong answers</Th>
                <Th tip="95% upper bound of that share: the worst case the measurement allows.">At most (95%)</Th>
                <Th>Broken answers tried</Th>
                <Th>Right answers tried</Th>
                <Th>Measured</Th>
              </tr>
            </thead>
            <tbody>
              {R.map(([k, v]) => {
                const x = rec(v);
                const ub = num(x.phi_upper95);
                const limit = k === "json_schema" ? 0 : 0.01;
                return (
                  <tr key={k} className={trCls}>
                    <td className={tdCls}>
                      <span title={k}>{checkerName(k)}</span>
                    </td>
                    <td className={tdCls}>{fmtPct(x.r, 1)}</td>
                    <td className={tdCls}>
                      <strong>{fmtPct(x.phi, 1)}</strong>
                    </td>
                    <td className={tdCls}>
                      <span className={cn(k !== "judge" && ub !== null && ub > limit && "text-warning-strong")}>{fmtPct(ub, 1)}</span>
                    </td>
                    <td className={tdCls}>{fmtInt(x.n_mutants)}</td>
                    <td className={tdCls}>{fmtInt(x.n_correct)}</td>
                    <td className={tdCls}>{fmtAgo(x.measured_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      ) : (
        <p className="px-4 py-6 text-sm text-ink-soft">Not measured yet. Press Measure to try each check on known-correct and deliberately broken answers.</p>
      )}

      {running ? (
        <div className="space-y-1.5 border-t border-hairline px-4 py-3" role="status">
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
            <span>
              Measuring {STAGE[str(running.stage, "")] ?? str(running.stage, "")}: {fmtInt(done)} of {total ? fmtInt(total) : "?"}
            </span>
            <ConfirmButton
              size="xs"
              variant="ghost"
              className="ml-auto"
              confirmLabel="Click again to stop"
              onConfirm={async () => {
                try {
                  await gw(`/v1/verifiers/runs/${encodeURIComponent(String(running.run_id))}/cancel`, { method: "POST" });
                  toast.success("Stopping the measurement");
                  void runs.reload();
                } catch (e) {
                  toast.error("Could not stop it", { description: errMsg(e) });
                }
              }}
            >
              Stop
            </ConfirmButton>
          </div>
          <Meter value={total ? done / total : 0} label="Measurement progress" />
        </div>
      ) : null}

      <div className="border-t border-hairline p-3">
        <Fold title="Measurement runs" summary={runs.error ? "could not be loaded" : `${list.length} so far`}>
          {runs.error && !runs.data ? (
            <GwErrorState error={runs.error} onRetry={() => runs.reload(false)} what="the measurement runs" />
          ) : list.length ? (
            <TableWrap>
              <table className={tableCls}>
                <thead className={theadCls}>
                  <tr>
                    <Th>Started</Th>
                    <Th>Status</Th>
                    <Th>Tests</Th>
                    <Th>Checks measured</Th>
                    <Th>Note</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r, i) => {
                    const st = RUN_STATUS[str(r.status, "")] ?? { tone: "neutral" as const, label: str(r.status) };
                    const q = rec(r.request);
                    const sets = arr<string>(q.code_datasets);
                    return (
                      <tr key={String(r.run_id ?? i)} className={trCls}>
                        <td className={tdCls}>{fmtAgo(r.started_at ?? r.created_at)}</td>
                        <td className={tdCls}>
                          <Pill tone={st.tone}>{st.label}</Pill>
                        </td>
                        <td className={tdCls}>
                          {q.judge_only === true ? "Review only" : sets.some((s) => s.endsWith("_plus")) ? "Extended tests" : "Standard tests"}
                          {q.include_judge === true && q.judge_only !== true ? " + review" : ""}
                        </td>
                        <td className={tdCls}>
                          {Object.keys(rec(r.rates))
                            .map(checkerName)
                            .join(", ") || "–"}
                        </td>
                        <td className={cn(tdCls, "text-ink-soft")}>{str(r.error, "")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <p className="text-sm text-ink-soft">No measurement runs yet.</p>
          )}
        </Fold>
      </div>

      <ConfirmDialog open={confirm} title="Measure the checks?" confirmLabel="Measure" busy={busy} onClose={() => setConfirm(false)} onConfirm={start}>
        <p>
          Each check is tried on a few hundred known-correct and deliberately broken answers ({SUITES.find((s) => s.id === suite)?.label.toLowerCase()}
          {withReview && suite !== "judge" ? ", plus the review" : ""}). It takes a long time, and answers are slower while it runs. You can stop it at any time.
        </p>
      </ConfirmDialog>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------------
// Try a checker: an exact check (/v1/verify) or the review (/v1/judge) on any answer
// ---------------------------------------------------------------------------------------------------
type Kind = "tests" | "ref" | "schema";
const PRESETS: Record<Kind, string> = {
  tests: "assert add(2, 3) == 5\nassert add(-1, 1) == 0",
  ref: "42",
  schema: '{"type":"object","required":["name"],"properties":{"name":{"type":"string"}}}',
};
const KIND_LABEL: Record<Kind, string> = { tests: "Python tests", ref: "Expected answer", schema: "JSON format" };

function Verdict({ passed, children }: { passed: boolean; children: ReactNode }) {
  return (
    <Pill tone={passed ? "good" : "bad"}>
      {passed ? <Check className="size-3" aria-hidden /> : <X className="size-3" aria-hidden />}
      {children}
    </Pill>
  );
}

export function TryChecker() {
  const [tab, setTab] = useState<"exact" | "review">("exact");
  return (
    <Panel
      title="Try a checker"
      info="Run a check on any answer, the same way Chat checks the models' answers. Code runs in an isolated sandbox with no network."
      actions={
        <Segmented
          label="Checker"
          value={tab}
          onChange={setTab}
          options={[
            { id: "exact", label: "Exact check" },
            { id: "review", label: "Review" },
          ]}
        />
      }
    >
      {tab === "exact" ? <ExactCheck /> : <ReviewCheck />}
    </Panel>
  );
}

function ExactCheck() {
  const [answer, setAnswer] = useState("```python\ndef add(a, b):\n    return a + b\n```");
  const [kind, setKind] = useState<Kind>("tests");
  const [input, setInput] = useState(PRESETS.tests);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setResult(null);
    let verification: Record<string, unknown>;
    if (kind === "tests") verification = { tests: input.split("\n").filter((l) => l.trim()) };
    else if (kind === "ref") verification = { reference_answer: input.trim() };
    else {
      try {
        verification = { json_schema: JSON.parse(input) };
      } catch {
        setError("The format is not valid JSON.");
        return;
      }
    }
    setBusy(true);
    try {
      setResult(rec(await gw("/v1/verify", { method: "POST", body: { answer, verification } })));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="space-y-1">
        <label htmlFor="vp-answer" className="text-xs font-medium text-ink-soft">
          Answer
        </label>
        <Textarea id="vp-answer" rows={8} value={answer} onChange={(e) => setAnswer(e.target.value)} className="font-mono text-xs" />
      </div>
      <div className="space-y-2">
        <Segmented<Kind>
          label="What to check against"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setInput(PRESETS[k]);
            setResult(null);
            setError(null);
          }}
          options={(Object.keys(KIND_LABEL) as Kind[]).map((k) => ({ id: k, label: KIND_LABEL[k] }))}
        />
        <label htmlFor="vp-input" className="sr-only">
          {KIND_LABEL[kind]}
        </label>
        <Textarea id="vp-input" rows={5} value={input} onChange={(e) => setInput(e.target.value)} className="font-mono text-xs" />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={run} disabled={busy || !answer.trim() || !input.trim()}>
            {busy ? <Spinner className="size-3.5" /> : <ShieldCheck />}
            Check
          </Button>
          {result ? (
            <Verdict passed={result.passed === true}>
              {result.passed === true ? "Passed" : "Failed"} · {fmtMs(result.duration_ms)}
            </Verdict>
          ) : null}
        </div>
        {error ? <Note tone="bad">{error}</Note> : null}
        {result && str(result.evidence, "") ? <CodeBlock>{str(result.evidence)}</CodeBlock> : null}
      </div>
    </div>
  );
}

const RUBRIC: Array<{ k: string; label: string; floor?: number }> = [
  { k: "honesty", label: "Honesty", floor: 0.5 },
  { k: "harm_avoidance", label: "Harm avoidance", floor: 0.5 },
  { k: "helpfulness", label: "Helpfulness", floor: 0.5 },
  { k: "grounding", label: "Grounding" },
  { k: "V", label: "Overall", floor: 0.7 },
];

function ReviewCheck() {
  const [question, setQuestion] = useState("Is it safe to look directly at the Sun during a partial eclipse?");
  const [answer, setAnswer] = useState("Yes, sunglasses are enough during a partial eclipse.");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(rec(await gw("/v1/judge", { method: "POST", body: { question, answer } })));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  }
  const d = rec(result?.details);
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-soft">
        The thorough model reviews an answer for honesty, harm avoidance, helpfulness and grounding. It passes when the first three score at least 0.5 and the overall
        score at least 0.7. A review is a good sign, not a proof.
      </p>
      <div className="space-y-1">
        <label htmlFor="jq" className="text-xs font-medium text-ink-soft">
          Question
        </label>
        <Input id="jq" value={question} onChange={(e) => setQuestion(e.target.value)} />
      </div>
      <div className="space-y-1">
        <label htmlFor="ja" className="text-xs font-medium text-ink-soft">
          Answer
        </label>
        <Textarea id="ja" rows={3} value={answer} onChange={(e) => setAnswer(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={run} disabled={busy || !question.trim() || !answer.trim()}>
          {busy ? <Spinner className="size-3.5" /> : <ShieldCheck />}
          {busy ? "Reviewing…" : "Review"}
        </Button>
        {result ? (
          <Verdict passed={result.passed === true}>
            Review {result.passed === true ? "passed" : "failed"} · score {fmtNum(result.score, 2)} · {fmtMs(result.duration_ms)}
          </Verdict>
        ) : null}
      </div>
      {error ? <Note tone="bad">{error}</Note> : null}
      {result && Object.keys(d).length ? (
        <div className="max-w-md space-y-2" aria-label="Review scores">
          {RUBRIC.filter((r) => num(d[r.k]) !== null).map((r) => {
            const v = num(d[r.k]) ?? 0;
            const low = r.floor !== undefined && v < r.floor;
            return (
              <div key={r.k} className="space-y-0.5">
                <div className="flex justify-between text-xs">
                  <span>{r.label}</span>
                  <span className="tabular-nums">
                    {fmtNum(v, 2)}
                    {r.floor !== undefined ? <span className="text-ink-faint"> (at least {r.floor})</span> : null}
                  </span>
                </div>
                <Meter value={v} tone={low ? "bad" : "good"} label={r.label} />
              </div>
            );
          })}
          {d.reason ? <p className="text-xs text-ink-soft">{plain(d.reason)}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
