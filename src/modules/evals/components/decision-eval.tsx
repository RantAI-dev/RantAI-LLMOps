"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Plus, Scale, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { InfoTip } from "@/components/ui/tooltip";
import type { DecisionCase, DecisionReport, QuestionReport } from "@/lib/decision-eval";
import type { DecisionEvalSet } from "@/lib/decision-eval-set-store";
import type { DecisionEvalRun, DecisionEvalRunSummary } from "@/lib/decision-eval-store";
import { cn } from "@/lib/utils";

const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;
const num = (n: number, digits = 3) => n.toFixed(digits);

const STATUS_LABEL: Record<DecisionEvalRun["status"], string> = {
  running: "running",
  done: "done",
  error: "failed",
  interrupted: "interrupted",
};

type Tone = "good" | "bad" | "neutral";

/** One headline number. `hint` says how to read it (higher or lower is better). */
function Metric({ label, value, hint, tone = "neutral" }: { label: string; value: string; hint: string; tone?: Tone }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-[11px] font-medium text-ink-soft">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-xl font-semibold tabular-nums",
          tone === "good" ? "text-success" : tone === "bad" ? "text-danger" : "text-ink"
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-ink-faint">{hint}</div>
    </div>
  );
}

const accTone = (v: number): Tone => (v >= 0.9 ? "good" : v < 0.6 ? "bad" : "neutral");
const eceTone = (v: number): Tone => (v <= 0.05 ? "good" : v > 0.15 ? "bad" : "neutral");

// ---------------------------------------------------------------------------------------------------
// Charts: plain SVG on a 0..1 square, text and lines from theme tokens so both themes read.
// ---------------------------------------------------------------------------------------------------

const SIZE = 220;
const PAD = 30;
const span = SIZE - PAD * 2;
const px = (v: number) => PAD + v * span;
const py = (v: number) => SIZE - PAD - v * span;
const TICKS = [0, 0.25, 0.5, 0.75, 1];

function Axes({ xLabel, yLabel }: { xLabel: string; yLabel: string }) {
  return (
    <g className="text-ink-soft">
      {TICKS.map((t) => (
        <g key={t}>
          <line x1={PAD} x2={SIZE - PAD} y1={py(t)} y2={py(t)} className="stroke-border" strokeWidth={0.5} />
          <text x={PAD - 4} y={py(t) + 3} textAnchor="end" fontSize={8} className="fill-current">
            {t * 100}
          </text>
          <text x={px(t)} y={SIZE - PAD + 11} textAnchor="middle" fontSize={8} className="fill-current">
            {t * 100}
          </text>
        </g>
      ))}
      <text x={SIZE / 2} y={SIZE - 4} textAnchor="middle" fontSize={9} className="fill-current">
        {xLabel}
      </text>
      <text x={9} y={SIZE / 2} textAnchor="middle" fontSize={9} className="fill-current" transform={`rotate(-90 9 ${SIZE / 2})`}>
        {yLabel}
      </text>
    </g>
  );
}

/** When the model says X%, is it right X% of the time? Points on the diagonal mean yes. */
function ReliabilityChart({ report }: { report: DecisionReport }) {
  const bins = report.reliability.filter((b) => b.count > 0);
  const maxCount = Math.max(1, ...bins.map((b) => b.count));
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Reliability diagram: stated confidence against actual accuracy" className="w-full max-w-[260px]">
      <Axes xLabel="Confidence the model stated (%)" yLabel="Actually right (%)" />
      <line x1={px(0)} y1={py(0)} x2={px(1)} y2={py(1)} className="stroke-ink-faint" strokeWidth={1} strokeDasharray="3 3" />
      <polyline
        points={bins.map((b) => `${px(b.confidence)},${py(b.accuracy)}`).join(" ")}
        fill="none"
        className="stroke-primary"
        strokeWidth={1.5}
      />
      {bins.map((b) => (
        <circle key={b.lo} cx={px(b.confidence)} cy={py(b.accuracy)} r={2.5 + (b.count / maxCount) * 3} className="fill-primary stroke-surface" strokeWidth={1}>
          <title>{`${pct(b.lo, 0)}–${pct(b.hi, 0)}: said ${pct(b.confidence)}, right ${pct(b.accuracy)} (${b.count} decisions)`}</title>
        </circle>
      ))}
    </svg>
  );
}

/** How many decisions can be automated at each confidence cut-off, and how accurate those are. */
function AutomationChart({ report }: { report: DecisionReport }) {
  const pts = report.automation.filter((p) => p.count > 0);
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Automation curve: share of decisions automated against their accuracy" className="w-full max-w-[260px]">
      <Axes xLabel="Decisions automated (%)" yLabel="Accuracy of those (%)" />
      <polyline points={pts.map((p) => `${px(p.coverage)},${py(p.accuracy)}`).join(" ")} fill="none" className="stroke-primary" strokeWidth={1.5} />
      {pts.map((p) => (
        <circle key={p.threshold} cx={px(p.coverage)} cy={py(p.accuracy)} r={3} className="fill-primary stroke-surface" strokeWidth={1}>
          <title>{`Confidence ≥ ${pct(p.threshold, 0)}: ${pct(p.coverage)} of decisions automated, ${pct(p.accuracy)} right`}</title>
        </circle>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------------

function QuestionTable({ questions }: { questions: QuestionReport[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-[12px]">
        <thead className="bg-surface-2 text-ink-soft">
          <tr>
            {["Question", "Type", "Decisions", "Accuracy", "Quality", "Calibration (ECE)", "Avg. confidence"].map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-1.5 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {questions.map((q) => (
            <tr key={q.name} className="border-t border-border">
              <td className="px-3 py-1.5 font-medium text-ink">{q.name}</td>
              <td className="px-3 py-1.5 text-ink-soft">{q.type}</td>
              <td className="px-3 py-1.5 tabular-nums">{q.n}</td>
              <td className="px-3 py-1.5 tabular-nums">{pct(q.accuracy)}</td>
              <td className="px-3 py-1.5 tabular-nums text-ink-soft">
                {q.type === "score"
                  ? `off by ${num(q.mae ?? 0, 2)} levels · ${pct(q.within1 ?? 0, 0)} within 1`
                  : `Macro-F1 ${pct(q.macroF1 ?? 0)}`}
              </td>
              <td className="px-3 py-1.5 tabular-nums">{num(q.ece)}</td>
              <td className="px-3 py-1.5 tabular-nums text-ink-soft">{pct(q.meanConfidence, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AutomationTable({ report }: { report: DecisionReport }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-[12px]">
        <thead className="bg-surface-2 text-ink-soft">
          <tr>
            {["Only if confidence ≥", "Automated", "Of those, right", "Sent to a person"].map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-1.5 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.automation.map((p) => (
            <tr key={p.threshold} className="border-t border-border">
              <td className="px-3 py-1.5 tabular-nums">{pct(p.threshold, 0)}</td>
              <td className="px-3 py-1.5 tabular-nums">{pct(p.coverage)}</td>
              <td className="px-3 py-1.5 tabular-nums">{p.count > 0 ? pct(p.accuracy) : "—"}</td>
              <td className="px-3 py-1.5 tabular-nums text-ink-soft">{pct(1 - p.coverage)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Wrong answers first, the most confident mistakes on top: those are the ones that would slip through. */
function Mistakes({ cases }: { cases: DecisionCase[] }) {
  const [open, setOpen] = useState(false);
  const wrong = useMemo(
    () =>
      cases
        .flatMap((c) =>
          Object.entries(c.results)
            .filter(([, r]) => !r.correct)
            .map(([q, r]) => ({ i: c.i, state: c.state, q, r }))
        )
        .sort((a, b) => b.r.conf - a.r.conf),
    [cases]
  );
  if (wrong.length === 0) return <p className="text-[12px] text-success">No mistakes: every decision was right.</p>;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 text-[12px] font-medium text-ink-soft hover:text-ink"
      >
        {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
        {wrong.length} wrong decision{wrong.length > 1 ? "s" : ""}, most confident first
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {wrong.slice(0, 100).map((w) => (
            <div key={`${w.i}-${w.q}`} className="rounded-lg border border-border bg-background p-2.5 text-[12px]">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-ink">{w.q}</span>
                <span className="rounded bg-success-soft px-1.5 py-0.5 text-[10px] font-semibold text-success">true: {w.r.gold}</span>
                <span className="rounded bg-danger-soft px-1.5 py-0.5 text-[10px] font-semibold text-danger">
                  said: {w.r.pred} ({pct(w.r.conf, 0)} sure)
                </span>
                <span className="text-[10px] text-ink-faint">gave the right answer {pct(w.r.pGold, 0)}</span>
              </div>
              <p className="break-words text-ink-soft">{w.state.slice(0, 260)}{w.state.length > 260 ? "…" : ""}</p>
            </div>
          ))}
          {wrong.length > 100 ? <p className="text-[11px] text-ink-faint">…and {wrong.length - 100} more.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function Report({ run }: { run: DecisionEvalRun }) {
  const r = run.report;
  if (!r) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric label="Accuracy" value={pct(r.accuracy)} hint="decisions right, higher is better" tone={accTone(r.accuracy)} />
        <Metric label="Rows fully right" value={pct(r.recordAccuracy)} hint="every question in the row right" tone={accTone(r.recordAccuracy)} />
        <Metric label="Calibration error (ECE)" value={num(r.ece)} hint="stated vs actual confidence, lower is better" tone={eceTone(r.ece)} />
        <Metric label="Brier score" value={num(r.brier)} hint="lower is better" />
        <Metric label="Log loss" value={num(r.logLoss)} hint="lower is better" />
        <Metric
          label="Automatable at 95%"
          value={r.coverageAt95 === null ? "none" : pct(r.coverageAt95)}
          hint={r.coverageAt95 === null ? "no cut-off reaches 95% accuracy" : "share of decisions you could automate at ≥95% accuracy"}
          tone={r.coverageAt95 === null ? "bad" : "neutral"}
        />
      </div>

      {run.errorCount > 0 ? (
        <div role="alert" className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-[12px] text-warning">
          {run.errorCount} of {run.total} rows could not be answered and are not counted
          {run.errorSample ? ` (${run.errorSample})` : ""}. The numbers cover the other {r.rows} rows.
        </div>
      ) : null}

      <QuestionTable questions={r.questions} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-1 text-[12px] font-medium text-ink-soft">Can you trust its confidence?</h3>
          <ReliabilityChart report={r} />
          <p className="mt-1 text-[11px] leading-4 text-ink-soft">
            Points on the dashed line mean that when the model says 80%, it is right 80% of the time. Points below
            it mean it is overconfident.
          </p>
        </div>
        <div>
          <h3 className="mb-1 text-[12px] font-medium text-ink-soft">What can be automated?</h3>
          <AutomationChart report={r} />
          <p className="mt-1 text-[11px] leading-4 text-ink-soft">
            Raise the confidence cut-off and fewer decisions are automated, but the ones left are more accurate.
            The rest go to a person.
          </p>
        </div>
      </div>

      <AutomationTable report={r} />

      {run.cases ? <Mistakes cases={run.cases} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// History + compare
// ---------------------------------------------------------------------------------------------------

type Row = { label: string; get: (r: DecisionReport) => number; fmt: (n: number) => string; higherIsBetter: boolean };
const COMPARE_ROWS: Row[] = [
  { label: "Accuracy", get: (r) => r.accuracy, fmt: pct, higherIsBetter: true },
  { label: "Rows fully right", get: (r) => r.recordAccuracy, fmt: pct, higherIsBetter: true },
  { label: "Calibration error (ECE)", get: (r) => r.ece, fmt: num, higherIsBetter: false },
  { label: "Brier score", get: (r) => r.brier, fmt: num, higherIsBetter: false },
  { label: "Log loss", get: (r) => r.logLoss, fmt: num, higherIsBetter: false },
  { label: "Automatable at 95%", get: (r) => r.coverageAt95 ?? 0, fmt: pct, higherIsBetter: true },
];

/** Two runs on the same test set side by side (typically base vs fine-tune, or v1 vs v2). */
function Compare({ a, b }: { a: DecisionEvalRun; b: DecisionEvalRun }) {
  if (!a.report || !b.report) return null;
  const ra = a.report;
  const rb = b.report;
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-[12px]">
        <thead className="bg-surface-2 text-ink-soft">
          <tr>
            <th className="px-3 py-1.5 text-left font-medium">Metric</th>
            <th className="px-3 py-1.5 text-left font-mono text-[11px] font-medium">{a.model}</th>
            <th className="px-3 py-1.5 text-left font-mono text-[11px] font-medium">{b.model}</th>
            <th className="px-3 py-1.5 text-left font-medium">Change</th>
          </tr>
        </thead>
        <tbody>
          {COMPARE_ROWS.map((row) => {
            const va = row.get(ra);
            const vb = row.get(rb);
            const diff = vb - va;
            const better = row.higherIsBetter ? diff > 0 : diff < 0;
            const same = Math.abs(diff) < 0.0005;
            return (
              <tr key={row.label} className="border-t border-border">
                <td className="px-3 py-1.5 font-medium text-ink">{row.label}</td>
                <td className="px-3 py-1.5 tabular-nums">{row.fmt(va)}</td>
                <td className="px-3 py-1.5 tabular-nums">{row.fmt(vb)}</td>
                <td className={cn("px-3 py-1.5 tabular-nums", same ? "text-ink-soft" : better ? "text-success" : "text-danger")}>
                  {same ? "no change" : `${diff > 0 ? "+" : ""}${row.fmt(diff)} ${better ? "(better)" : "(worse)"}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function History({
  runs,
  activeId,
  onOpen,
  onDelete,
}: {
  runs: DecisionEvalRunSummary[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (runs.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="mb-2 text-sm font-semibold text-primary">Run history</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[12px]">
          <thead className="bg-surface-2 text-ink-soft">
            <tr>
              {["Time", "Model", "Test set", "Status", "Accuracy", "ECE", ""].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-1.5 text-left font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className={cn("border-t border-border hover:bg-surface-2", r.id === activeId && "bg-primary-soft/40")}>
                <td className="whitespace-nowrap px-3 py-1.5 text-ink-soft">
                  <button type="button" onClick={() => onOpen(r.id)} className="text-left hover:underline">
                    {new Date(r.createdAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                  </button>
                </td>
                <td className="max-w-[14rem] truncate px-3 py-1.5 font-mono text-[11px] text-ink" title={r.model}>{r.model}</td>
                <td className="max-w-[10rem] truncate px-3 py-1.5 text-ink-soft" title={r.setName}>{r.setName}</td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-medium",
                      r.status === "done" ? "bg-success-soft text-success" : r.status === "running" ? "bg-primary-soft text-primary" : "bg-danger-soft text-danger"
                    )}
                  >
                    {STATUS_LABEL[r.status]}
                    {r.status === "running" ? ` ${r.completed}/${r.total}` : ""}
                  </span>
                </td>
                <td className="px-3 py-1.5 tabular-nums">{r.report ? pct(r.report.accuracy) : "—"}</td>
                <td className="px-3 py-1.5 tabular-nums">{r.report ? num(r.report.ece) : "—"}</td>
                <td className="px-3 py-1.5">
                  <button
                    type="button"
                    aria-label="Delete run"
                    onClick={() => onDelete(r.id)}
                    className="rounded p-1 text-ink-soft hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// Adding a test set
// ---------------------------------------------------------------------------------------------------

function AddTestSet({ onAdded }: { onAdded: (set: DecisionEvalSet) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"file" | "hf">("file");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [hfId, setHfId] = useState("LocalLLaMA/typed-decisions");
  const [hfConfig, setHfConfig] = useState("all");
  const [hfSplit, setHfSplit] = useState("test");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canAdd = !busy && name.trim().length > 0 && (mode === "file" ? file !== null : hfId.trim().length > 0);

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      let res: Response;
      if (mode === "file" && file) {
        const form = new FormData();
        form.append("name", name.trim());
        form.append("file", file);
        res = await fetch("/api/evals/decision/sets", { method: "POST", body: form });
      } else {
        res = await fetch("/api/evals/decision/sets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), dataset: hfId.trim(), config: hfConfig.trim(), split: hfSplit.trim() }),
        });
      }
      const data = (await res.json()) as { set?: DecisionEvalSet; error?: string } & Partial<DecisionEvalSet>;
      if (!res.ok) throw new Error(data.error || `Could not add the test set (${res.status})`);
      const added = data.set ?? (data as DecisionEvalSet);
      onAdded(added);
      setOpen(false);
      setName("");
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add the test set");
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
        <Plus className="size-3.5" aria-hidden /> Add a test set
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1">
          <span className="mb-1 block text-[12px] font-medium text-ink">Test set name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. tickets-test" disabled={busy} />
        </label>
        <div role="group" aria-label="Test set source" className="inline-flex rounded-md bg-surface-2 p-0.5">
          {(["file", "hf"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              disabled={busy}
              className={cn("rounded px-2.5 py-1 text-[12px] font-medium", mode === m ? "bg-surface text-primary shadow-sm" : "text-ink-soft hover:text-ink")}
            >
              {m === "file" ? "File" : "Hugging Face"}
            </button>
          ))}
        </div>
      </div>
      {mode === "file" ? (
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink">
            JSONL file of {`{state, questions, gold}`} rows (at least 5, up to 20 MB)
          </span>
          <input
            type="file"
            accept=".jsonl,.ndjson,.json"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-[12px] text-ink-soft file:mr-2 file:rounded-md file:border file:border-input file:bg-background file:px-2 file:py-1 file:text-[12px]"
          />
        </label>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-3 block sm:col-span-1">
            <span className="mb-1 block text-[12px] font-medium text-ink">Dataset id</span>
            <Input value={hfId} onChange={(e) => setHfId(e.target.value)} disabled={busy} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink">Subset</span>
            <Input value={hfConfig} onChange={(e) => setHfConfig(e.target.value)} disabled={busy} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-ink">Split</span>
            <Input value={hfSplit} onChange={(e) => setHfSplit(e.target.value)} disabled={busy} />
          </label>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={add} disabled={!canAdd}>
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
          {busy ? "Adding…" : "Add test set"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------------------------------

type ServedState = { server?: { configured?: boolean; reachable?: boolean; models?: Array<{ name: string; loaded: boolean }> } };

/**
 * System One eval: grade a SERVED decision model on a labelled test set. A decision model does not
 * write text, so this is not a benchmark or a text comparison: it measures whether each typed answer is
 * right AND whether the confidence the model states can be trusted (calibration), and from that how
 * many decisions a team could safely automate. Runs on the server, so the page can be closed.
 */
export function DecisionEval() {
  const [served, setServed] = useState<string[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [model, setModel] = useState("");
  const [sets, setSets] = useState<DecisionEvalSet[]>([]);
  const [setId, setSetId] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [runs, setRuns] = useState<DecisionEvalRunSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<DecisionEvalRun | null>(null);
  const [compareId, setCompareId] = useState("");
  const [compareRun, setCompareRun] = useState<DecisionEvalRun | null>(null);
  const attached = useRef(false);

  const loadRuns = useCallback(async () => {
    try {
      const d = (await (await fetch("/api/evals/decision", { cache: "no-store" })).json()) as {
        runs?: DecisionEvalRunSummary[];
        sets?: DecisionEvalSet[];
      };
      const list = d.runs ?? [];
      setRuns(list);
      setSets(d.sets ?? []);
      setSetId((cur) => cur || d.sets?.[0]?.id || "");
      if (!attached.current) {
        attached.current = true;
        const inFlight = list.find((r) => r.status === "running");
        if (inFlight) setActiveId(inFlight.id);
      }
    } catch {
      /* keep whatever is on screen */
    }
  }, []);

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("model") ?? "";
    fetch("/api/decision/models", { cache: "no-store" })
      .then((r) => r.json() as Promise<ServedState>)
      .then((d) => {
        setConfigured(d.server?.configured !== false);
        const names = (d.server?.models ?? []).filter((m) => m.loaded).map((m) => m.name);
        setServed(names);
        setModel((cur) => cur || (wanted && names.includes(wanted) ? wanted : names[0] || ""));
      })
      .catch(() => setServed([]));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot load on mount; state is set only after the request resolves, and this reattaches to a run still in flight
    void loadRuns();
  }, [loadRuns]);

  // Poll the open run until it finishes.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const d = (await (await fetch(`/api/evals/decision/${activeId}`, { cache: "no-store" })).json()) as { run?: DecisionEvalRun };
        if (cancelled || !d.run) return;
        setActive(d.run);
        if (d.run.status === "running") timer = setTimeout(tick, 2000);
        else void loadRuns();
      } catch {
        if (!cancelled) timer = setTimeout(tick, 4000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeId, loadRuns]);

  useEffect(() => {
    if (!compareId) return;
    let cancelled = false;
    fetch(`/api/evals/decision/${compareId}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<{ run?: DecisionEvalRun }>)
      .then((d) => !cancelled && setCompareRun(d.run ?? null))
      .catch(() => !cancelled && setCompareRun(null));
    return () => {
      cancelled = true;
    };
  }, [compareId]);

  const start = async () => {
    setStarting(true);
    setError(null);
    setActive(null);
    try {
      const res = await fetch("/api/evals/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, setId }),
      });
      const data = (await res.json()) as { runId?: string; error?: string };
      if (!res.ok || !data.runId) throw new Error(data.error || `Failed to start the eval (${res.status})`);
      setCompareId("");
      setActiveId(data.runId);
      void loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start the eval");
    } finally {
      setStarting(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/evals/decision/${id}`, { method: "DELETE" }).catch(() => {});
    if (id === activeId) {
      setActiveId(null);
      setActive(null);
    }
    if (id === compareId) {
      setCompareId("");
      setCompareRun(null);
    }
    void loadRuns();
  };

  const running = active?.status === "running";
  const selectedSet = sets.find((s) => s.id === setId);
  const comparable = runs.filter((r) => r.status === "done" && r.id !== activeId && active && r.setId === active.setId);

  if (!configured) {
    return (
      <div className="rounded-xl border border-border bg-surface p-4 text-[13px] text-ink-soft">
        This workspace has no decision server configured, so there is no System One model to evaluate. See Deployments.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-1.5">
          <Scale className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold text-primary">Decision eval (System One)</h2>
          <InfoTip label="About decision eval">
            A decision model answers typed questions with a probability instead of writing text, so it is graded
            differently: is each answer <strong>right</strong>, and is its stated confidence{" "}
            <strong>honest</strong>? From that you see how many decisions could be automated at a given accuracy and how
            many should go to a person. Run it on the base model and on your fine-tune to see the effect.
          </InfoTip>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">Decision model (served)</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
            >
              {served === null ? <option value="">Loading…</option> : null}
              {served?.length === 0 ? <option value="">No decision model is served</option> : null}
              {served?.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">Test set</span>
            <select
              value={setId}
              onChange={(e) => setSetId(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
            >
              {sets.length === 0 ? <option value="">No test set yet</option> : null}
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.rows} rows
                </option>
              ))}
            </select>
          </label>
        </div>

        {served?.length === 0 ? (
          <p className="mt-2 text-[12px] text-ink-soft">
            Nothing to grade yet: deploy a finished decision job in{" "}
            <a href="/serve" className="font-medium text-primary hover:underline">
              Deployments
            </a>
            .
          </p>
        ) : null}
        {selectedSet ? (
          <p className="mt-2 text-[11px] text-ink-soft">
            Questions: {selectedSet.questions.join(", ") || "none"} · from{" "}
            {selectedSet.source === "dataset" ? "a dataset's test file" : selectedSet.source === "huggingface" ? "Hugging Face" : "an upload"}.
          </p>
        ) : null}

        <div className="mt-3">
          <AddTestSet
            onAdded={(s) => {
              setSets((cur) => [s, ...cur.filter((x) => x.id !== s.id)]);
              setSetId(s.id);
              void loadRuns();
            }}
          />
        </div>

        {error ? (
          <div role="alert" className="mt-3 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-3">
          <Button type="button" onClick={start} disabled={starting || running || !model || !setId}>
            {starting || running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {running ? "Running…" : "Run eval"}
          </Button>
          {selectedSet ? <span className="text-[11px] text-ink-soft">Sends {selectedSet.rows} rows to the model.</span> : null}
        </div>
      </div>

      {active ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-primary">Result</h3>
            <span className="font-mono text-[11px] text-ink-soft">{active.model}</span>
            <span className="text-[11px] text-ink-faint">on {active.setName}</span>
          </div>
          {active.status === "running" ? (
            <div role="status" className="space-y-1">
              <Progress value={active.total ? (active.completed / active.total) * 100 : 0} className="h-1.5" />
              <p className="text-[11px] text-ink-soft">
                {active.completed} of {active.total} rows answered…
              </p>
            </div>
          ) : active.status === "done" ? (
            <Report run={active} />
          ) : (
            <div role="alert" className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
              {active.status === "interrupted"
                ? "This run was interrupted (the app restarted). Run it again."
                : active.error || "The eval failed."}
              {active.errorSample ? <span className="mt-1 block text-[12px]">{active.errorSample}</span> : null}
            </div>
          )}
        </div>
      ) : null}

      {active?.status === "done" && comparable.length > 0 ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <label className="mb-2 flex flex-wrap items-center gap-2 text-[13px] font-medium text-ink">
            Compare with another run on the same test set
            <select
              value={compareId}
              onChange={(e) => {
                setCompareRun(null);
                setCompareId(e.target.value);
              }}
              className="h-8 rounded-md border border-input bg-background px-2 text-[12px] font-normal"
            >
              <option value="">Choose a run…</option>
              {comparable.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.model} · {new Date(r.createdAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                </option>
              ))}
            </select>
          </label>
          {compareRun ? <Compare a={compareRun} b={active} /> : null}
        </div>
      ) : null}

      <History runs={runs} activeId={activeId} onOpen={setActiveId} onDelete={remove} />
    </div>
  );
}
