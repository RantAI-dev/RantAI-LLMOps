"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Eye, Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { InfoTip } from "@/components/ui/tooltip";
import { formatInterval, formatPct } from "@/lib/eval-stats";
import { compareVlmCases, VLM_SCORING_LABEL, VLM_SCORING_MODES, type VlmCase, type VlmScoring } from "@/lib/vlm-eval";
import type { VlmEvalRow, VlmEvalSet } from "@/lib/vlm-eval-set-store";
import type { VlmEvalRun, VlmEvalRunSummary } from "@/lib/vlm-eval-store";
import { cn } from "@/lib/utils";
import { useEngines } from "@/modules/serve/hooks/use-engines";

const pct = (n: number, digits = 1) => formatPct(n, digits);
const num = (n: number, digits = 3) => n.toFixed(digits);
const when = (t: number) => new Date(t).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });

const STATUS_LABEL: Record<VlmEvalRun["status"], string> = {
  running: "running",
  done: "done",
  error: "failed",
  interrupted: "interrupted",
};

const imageUrl = (setId: string, path: string) => `/api/evals/vlm/sets/${encodeURIComponent(setId)}/image?path=${encodeURIComponent(path)}`;

/** A small picture from a test set; hidden when the set (or the file) is gone. */
function Thumb({ setId, path, size = 48 }: { setId: string; path?: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (!path || broken) {
    return <div style={{ width: size, height: size }} className="flex shrink-0 items-center justify-center rounded border border-border bg-surface-2 text-[9px] text-ink-faint">no image</div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a same-origin, auth-gated image route; next/image would add nothing
    <img
      src={imageUrl(setId, path)}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
      style={{ width: size, height: size }}
      className="shrink-0 rounded border border-border bg-white object-contain"
    />
  );
}

type Tone = "good" | "bad" | "neutral";

/** One headline number. `hint` says how to read it (higher or lower is better). */
function Metric({ label, value, hint, tone = "neutral" }: { label: string; value: string; hint: string; tone?: Tone }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-[11px] font-medium text-ink-soft">{label}</div>
      <div className={cn("mt-0.5 text-xl font-semibold tabular-nums", tone === "good" ? "text-success" : tone === "bad" ? "text-danger" : "text-ink")}>{value}</div>
      <div className="mt-0.5 text-[10px] text-ink-faint">{hint}</div>
    </div>
  );
}

const accTone = (v: number): Tone => (v >= 0.9 ? "good" : v < 0.5 ? "bad" : "neutral");

function Badge({ kind }: { kind: "right" | "wrong" | "error" }) {
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold",
        kind === "right" ? "bg-success-soft text-success" : kind === "wrong" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"
      )}
    >
      {kind === "right" ? "correct" : kind === "wrong" ? "incorrect" : "no answer (error)"}
    </span>
  );
}

const caseKind = (c: VlmCase): "right" | "wrong" | "error" => (c.error ? "error" : c.correct ? "right" : "wrong");

// ---------------------------------------------------------------------------------------------------
// Report + case table
// ---------------------------------------------------------------------------------------------------

type Show = "all" | "wrong" | "errors";
const PAGE = 40;

function CaseTable({ run, cases }: { run: Pick<VlmEvalRun, "setId" | "scoring">; cases: VlmCase[] }) {
  const [show, setShow] = useState<Show>("all");
  const [category, setCategory] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const categories = useMemo(() => [...new Set(cases.map((c) => c.category).filter((c): c is string => !!c))].sort(), [cases]);
  const rows = useMemo(
    () =>
      cases.filter((c) => {
        if (category && c.category !== category) return false;
        if (show === "wrong") return !c.error && !c.correct;
        if (show === "errors") return !!c.error;
        return true;
      }),
    [cases, show, category]
  );
  const latex = run.scoring === "latex";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <h3 className="mr-1 text-[12px] font-medium text-ink-soft">Cases</h3>
        <label className="inline-flex items-center gap-1 text-ink-soft">
          Show
          <select
            value={show}
            onChange={(e) => {
              setShow(e.target.value as Show);
              setLimit(PAGE);
            }}
            className="h-7 rounded-md border border-input bg-background px-1.5 text-[12px]"
          >
            <option value="all">all</option>
            <option value="wrong">wrong only</option>
            <option value="errors">request errors only</option>
          </select>
        </label>
        {categories.length > 0 ? (
          <label className="inline-flex items-center gap-1 text-ink-soft">
            Category
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setLimit(PAGE);
              }}
              className="h-7 rounded-md border border-input bg-background px-1.5 text-[12px]"
            >
              <option value="">all</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <span className="text-[11px] text-ink-faint">{rows.length} of {cases.length}</span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[12px]">
          <thead className="bg-surface-2 text-ink-soft">
            <tr>
              {["Image", "Prompt", "Key", "Model answer", "Result"].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-1.5 text-left font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((c) => (
              <tr key={c.id} className="border-t border-border align-top">
                <td className="px-3 py-1.5">
                  <Thumb setId={run.setId} path={c.image} />
                </td>
                <td className="max-w-[12rem] px-3 py-1.5 text-ink-soft">
                  <span className="line-clamp-3 break-words" title={c.prompt}>{c.prompt}</span>
                  {c.category ? <span className="mt-0.5 block text-[10px] text-ink-faint">{c.category}</span> : null}
                </td>
                <td className="max-w-[12rem] px-3 py-1.5 font-mono text-[11px] text-ink"><span className="line-clamp-4 break-all" title={c.gold}>{c.gold}</span></td>
                <td className="max-w-[14rem] px-3 py-1.5 font-mono text-[11px] text-ink">
                  {c.error ? <span className="text-warning">{c.error}</span> : <span className="line-clamp-4 break-all" title={c.pred}>{c.pred || <em className="text-ink-faint">empty</em>}</span>}
                  {c.truncated ? <span className="mt-0.5 block font-sans text-[10px] text-warning">cut off by the token limit</span> : null}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <Badge kind={caseKind(c)} />
                  {latex && c.cer !== undefined && !c.error ? <span className="mt-0.5 block text-[10px] text-ink-faint">CER {num(c.cer, 2)}</span> : null}
                  {run.scoring === "anls" && !c.error ? <span className="mt-0.5 block text-[10px] text-ink-faint">score {num(c.score, 2)}</span> : null}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-ink-soft">
                  {show === "wrong" ? "No wrong answers here." : "Nothing matches."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {rows.length > limit ? (
        <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="text-[12px] font-medium text-primary hover:underline">
          Show {Math.min(PAGE, rows.length - limit)} more
        </button>
      ) : null}
    </div>
  );
}

function Report({ run }: { run: VlmEvalRun }) {
  const r = run.report;
  if (!r) return null;
  const interval = formatInterval(r.interval);
  const latex = r.mode === "latex";
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Metric
          label={latex ? "Exact match" : r.mode === "anls" ? "Answers above the ANLS threshold" : "Accuracy"}
          value={pct(r.accuracy)}
          hint={interval ? `95% interval ${interval} · ${r.correct} of ${r.scored}` : `${r.correct} of ${r.scored}`}
          tone={accTone(r.accuracy)}
        />
        {latex && r.meanCer !== undefined ? (
          <Metric label="Mean CER" value={num(r.meanCer)} hint="character error rate, lower is better" tone={r.meanCer <= 0.1 ? "good" : r.meanCer > 0.5 ? "bad" : "neutral"} />
        ) : null}
        {r.mode === "anls" ? <Metric label="ANLS" value={num(r.meanScore)} hint="mean similarity, higher is better" /> : null}
        <Metric label="Rows scored" value={`${r.scored} / ${r.rows}`} hint={`scoring: ${VLM_SCORING_LABEL[r.mode]}`} />
        {r.empty > 0 || r.truncated > 0 ? (
          <Metric
            label="Empty / cut off"
            value={`${r.empty} / ${r.truncated}`}
            hint="empty answers / answers stopped by the token limit"
            tone={r.empty + r.truncated > r.scored * 0.1 ? "bad" : "neutral"}
          />
        ) : null}
        {r.meanLatencyMs !== undefined ? <Metric label="Latency per row" value={`${(r.meanLatencyMs / 1000).toFixed(1)} s`} hint="mean, with 2 requests in flight" /> : null}
      </div>

      {r.errors > 0 ? (
        <div role="alert" className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-[12px] text-warning">
          {r.errors} of {r.rows} rows could not be answered and are not counted
          {run.errorSample ? ` (${run.errorSample})` : ""}. The numbers cover the other {r.scored} rows.
        </div>
      ) : null}
      {r.truncated > 0 ? (
        <p className="text-[11px] text-ink-soft">
          {r.truncated} answer{r.truncated > 1 ? "s were" : " was"} stopped by the token limit ({run.maxTokens}); a longer limit may change their score.
        </p>
      ) : null}

      {r.categories.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[12px]">
            <thead className="bg-surface-2 text-ink-soft">
              <tr>
                {["Category", "Rows", "Accuracy", "95% interval", ...(latex ? ["Mean CER"] : [])].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-1.5 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.categories.map((c) => (
                <tr key={c.category} className="border-t border-border">
                  <td className="px-3 py-1.5 font-medium text-ink">{c.category}</td>
                  <td className="px-3 py-1.5 tabular-nums">{c.n}</td>
                  <td className="px-3 py-1.5 tabular-nums">{pct(c.accuracy)}</td>
                  <td className="px-3 py-1.5 tabular-nums text-ink-soft">{formatInterval(c.interval) ?? "—"}</td>
                  {latex ? <td className="px-3 py-1.5 tabular-nums">{c.meanCer !== undefined ? num(c.meanCer) : "—"}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {run.cases ? <CaseTable run={run} cases={run.cases} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------------------------------

const VERDICT: Record<"better" | "worse" | "tie" | "unknown", string> = {
  better: "better, beyond the measurement error",
  worse: "worse, beyond the measurement error",
  tie: "no measurable difference",
  unknown: "cannot tell",
};

function Flips({ title, ids, a, b, setId, tone }: { title: string; ids: number[]; a: VlmCase[]; b: VlmCase[]; setId: string; tone: "good" | "bad" }) {
  const [open, setOpen] = useState(false);
  const byA = useMemo(() => new Map(a.map((c) => [c.id, c])), [a]);
  const byB = useMemo(() => new Map(b.map((c) => [c.id, c])), [b]);
  if (ids.length === 0) return <p className="text-[12px] text-ink-soft">{title}: none.</p>;
  return (
    <div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={cn("flex items-center gap-1 text-[12px] font-medium", tone === "good" ? "text-success" : "text-danger")}>
        {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
        {title}: {ids.length}
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {ids.slice(0, 50).map((id) => {
            const ca = byA.get(id);
            const cb = byB.get(id);
            if (!ca || !cb) return null;
            return (
              <div key={id} className="flex gap-2 rounded-lg border border-border bg-background p-2 text-[12px]">
                <Thumb setId={setId} path={ca.image ?? cb.image} />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="line-clamp-2 text-ink-soft" title={ca.prompt}>{ca.prompt}</p>
                  <p className="break-all font-mono text-[11px]"><span className="font-sans text-ink-faint">key </span>{ca.gold}</p>
                  <p className="break-all font-mono text-[11px]"><span className="font-sans text-ink-faint">A </span>{ca.pred || "—"}</p>
                  <p className="break-all font-mono text-[11px]"><span className="font-sans text-ink-faint">B </span>{cb.pred || "—"}</p>
                </div>
              </div>
            );
          })}
          {ids.length > 50 ? <p className="text-[11px] text-ink-faint">…and {ids.length - 50} more.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Two runs on the same test set side by side (typically base vs fine-tune): A is the baseline, B the run being judged. */
function Compare({ a, b }: { a: VlmEvalRun; b: VlmEvalRun }) {
  const cmp = useMemo(() => (a.cases && b.cases ? compareVlmCases(a.cases, b.cases) : null), [a.cases, b.cases]);
  if (!cmp || !a.cases || !b.cases) return null;
  const intervalA = formatInterval(cmp.intervalA);
  const intervalB = formatInterval(cmp.intervalB);
  const latex = cmp.cerDelta !== undefined;
  const tone = cmp.verdict === "better" ? "text-success" : cmp.verdict === "worse" ? "text-danger" : "text-ink-soft";
  const sign = (n: number) => (n > 0 ? "+" : "");
  const cerTone = cmp.cerDelta === undefined || Math.abs(cmp.cerDelta) < 0.0005 ? "text-ink-soft" : cmp.cerDelta < 0 ? "text-success" : "text-danger";
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[12px]">
          <thead className="bg-surface-2 text-ink-soft">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Metric</th>
              <th className="px-3 py-1.5 text-left font-medium">A <span className="font-mono text-[11px]">{a.model}</span></th>
              <th className="px-3 py-1.5 text-left font-medium">B <span className="font-mono text-[11px]">{b.model}</span></th>
              <th className="px-3 py-1.5 text-left font-medium">Change (B vs A)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              <td className="px-3 py-1.5 font-medium text-ink">{latex ? "Exact match" : "Accuracy"}</td>
              <td className="px-3 py-1.5 tabular-nums">{pct(cmp.accA)}{intervalA ? <span className="block text-[10px] text-ink-faint">{intervalA}</span> : null}</td>
              <td className="px-3 py-1.5 tabular-nums">{pct(cmp.accB)}{intervalB ? <span className="block text-[10px] text-ink-faint">{intervalB}</span> : null}</td>
              <td className={cn("px-3 py-1.5 tabular-nums", tone)}>
                {sign(cmp.delta)}{(cmp.delta * 100).toFixed(1)} points
                <span className="block text-[10px]">{VERDICT[cmp.verdict]}</span>
              </td>
            </tr>
            {latex ? (
              <tr className="border-t border-border">
                <td className="px-3 py-1.5 font-medium text-ink">Mean CER</td>
                <td className="px-3 py-1.5 tabular-nums">{num(cmp.cerA ?? 0)}</td>
                <td className="px-3 py-1.5 tabular-nums">{num(cmp.cerB ?? 0)}</td>
                <td className={cn("px-3 py-1.5 tabular-nums", cerTone)}>
                  {Math.abs(cmp.cerDelta ?? 0) < 0.0005 ? "no change" : `${sign(cmp.cerDelta ?? 0)}${num(cmp.cerDelta ?? 0)} (${(cmp.cerDelta ?? 0) < 0 ? "better" : "worse"})`}
                </td>
              </tr>
            ) : null}
            <tr className="border-t border-border">
              <td className="px-3 py-1.5 font-medium text-ink">Rows compared</td>
              <td colSpan={3} className="px-3 py-1.5 tabular-nums text-ink-soft">{cmp.paired} rows scored in both runs</td>
            </tr>
          </tbody>
        </table>
      </div>
      <Flips title="Improved (wrong in A, right in B)" ids={cmp.improved} a={a.cases} b={b.cases} setId={a.setId} tone="good" />
      <Flips title="Regressed (right in A, wrong in B)" ids={cmp.regressed} a={a.cases} b={b.cases} setId={a.setId} tone="bad" />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------------------------------

function History({ runs, activeId, onOpen, onDelete }: { runs: VlmEvalRunSummary[]; activeId: string | null; onOpen: (id: string) => void; onDelete: (id: string) => void }) {
  if (runs.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="mb-2 text-sm font-semibold text-primary">Run history</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[12px]">
          <thead className="bg-surface-2 text-ink-soft">
            <tr>
              {["Time", "Model", "Test set", "Status", "Accuracy", "CER", ""].map((h) => (
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
                    {when(r.startedAt)}
                  </button>
                </td>
                <td className="max-w-[14rem] truncate px-3 py-1.5 font-mono text-[11px] text-ink" title={`${r.model} (${r.engine})`}>{r.model}</td>
                <td className="max-w-[10rem] truncate px-3 py-1.5 text-ink-soft" title={r.setName}>{r.setName}</td>
                <td className="whitespace-nowrap px-3 py-1.5">
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", r.status === "done" ? "bg-success-soft text-success" : r.status === "running" ? "bg-primary-soft text-primary" : "bg-danger-soft text-danger")}>
                    {STATUS_LABEL[r.status]}
                    {r.status === "running" ? ` ${r.progress.completed}/${r.progress.total}` : ""}
                  </span>
                </td>
                <td className="px-3 py-1.5 tabular-nums">{r.report ? pct(r.report.accuracy) : "—"}</td>
                <td className="px-3 py-1.5 tabular-nums">{r.report?.meanCer !== undefined ? num(r.report.meanCer) : "—"}</td>
                <td className="px-3 py-1.5">
                  <button type="button" aria-label="Delete run" onClick={() => onDelete(r.id)} className="rounded p-1 text-ink-soft hover:bg-danger-soft hover:text-danger">
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
// Test sets: upload, list, preview
// ---------------------------------------------------------------------------------------------------

const MAX_ZIP_MB = 100;

function AddTestSet({ onAdded }: { onAdded: (set: VlmEvalSet) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scoring, setScoring] = useState<VlmScoring>("exact");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAdd = !busy && name.trim().length > 0 && file !== null;

  const add = async () => {
    if (!file) return;
    if (file.size > MAX_ZIP_MB * 1024 * 1024) {
      setError(`The ZIP can be at most ${MAX_ZIP_MB} MB`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("name", name.trim());
      form.append("scoring", scoring);
      form.append("file", file);
      const res = await fetch("/api/evals/vlm/sets", { method: "POST", body: form });
      const data = (await res.json()) as { set?: VlmEvalSet; error?: string };
      if (!res.ok || !data.set) throw new Error(data.error || `Could not add the test set (${res.status})`);
      onAdded(data.set);
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
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink">Test set name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. latex-ocr-test" disabled={busy} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-ink">How answers are scored</span>
          <select value={scoring} onChange={(e) => setScoring(e.target.value as VlmScoring)} disabled={busy} className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]">
            {VLM_SCORING_MODES.map((m) => (
              <option key={m} value={m}>
                {VLM_SCORING_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-[12px] font-medium text-ink">
          ZIP with <code>train.jsonl</code> (every row is scored; the user message is the prompt, the assistant message the key) and <code>images/</code> — at least 5 rows, up to 500
        </span>
        <input
          type="file"
          accept=".zip,application/zip"
          disabled={busy}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-[12px] text-ink-soft file:mr-2 file:rounded-md file:border file:border-input file:bg-background file:px-2 file:py-1 file:text-[12px]"
        />
      </label>
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

/** The first rows of a set as thumbnails, so a person can see what the model will be asked. */
function SetPreview({ set }: { set: VlmEvalSet }) {
  const [loaded, setLoaded] = useState<{ id: string; rows: VlmEvalRow[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/evals/vlm/sets/${encodeURIComponent(set.id)}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<{ preview?: VlmEvalRow[] }>)
      .then((d) => !cancelled && setLoaded({ id: set.id, rows: d.preview ?? [] }))
      .catch(() => !cancelled && setLoaded({ id: set.id, rows: [] }));
    return () => {
      cancelled = true;
    };
  }, [set.id]);
  const rows = loaded?.id === set.id ? loaded.rows : null;
  if (rows === null) return <p className="text-[11px] text-ink-soft">Loading preview…</p>;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {rows.map((r) => (
        <div key={r.id} className="rounded-lg border border-border bg-background p-1.5">
          <div className="flex h-24 items-center justify-center overflow-hidden rounded bg-white">
            <Thumb setId={set.id} path={r.images[0]} size={92} />
          </div>
          <p className="mt-1 line-clamp-2 text-[10px] text-ink-soft" title={r.prompt}>{r.prompt}</p>
          <p className="line-clamp-2 break-all font-mono text-[10px] text-ink" title={r.gold}>{r.gold}</p>
        </div>
      ))}
    </div>
  );
}

function SetList({ sets, selectedId, onDelete }: { sets: VlmEvalSet[]; selectedId: string; onDelete: (id: string) => void }) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  if (sets.length === 0) return null;
  const preview = sets.find((s) => s.id === previewId);
  return (
    <div className="space-y-2">
      <div className="divide-y divide-border rounded-md border border-border">
        {sets.map((s) => (
          <div key={s.id} className={cn("flex flex-wrap items-center gap-2 px-3 py-1.5 text-[12px]", s.id === selectedId && "bg-primary-soft/30")}>
            <span className="font-medium text-ink">{s.name}</span>
            <span className="text-ink-soft">{s.rows} rows · {s.images} images · {VLM_SCORING_LABEL[s.scoring]}</span>
            <span className="ml-auto flex items-center gap-1">
              <button
                type="button"
                aria-pressed={previewId === s.id}
                onClick={() => setPreviewId((cur) => (cur === s.id ? null : s.id))}
                className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-ink-soft hover:bg-surface-2 hover:text-ink"
              >
                <Eye className="size-3.5" aria-hidden /> {previewId === s.id ? "Hide" : "Preview"}
              </button>
              <button
                type="button"
                aria-label={`Delete test set ${s.name}`}
                onClick={() => {
                  if (window.confirm(`Delete the test set "${s.name}"? Its past runs stay, but their thumbnails go.`)) onDelete(s.id);
                }}
                className="rounded p-1 text-ink-soft hover:bg-danger-soft hover:text-danger"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </span>
          </div>
        ))}
      </div>
      {preview ? <SetPreview set={preview} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------------------------------

/**
 * Vision eval: grade a SERVED model on your own images. Each row of a test set is an image, a prompt and the
 * right answer; the model answers through its engine (vLLM, SGLang or Ollama) and the answer is scored by the
 * set's rule (exact, LaTeX with character error rate, numeric within 5%, ANLS, multiple choice). Run it on the
 * base model and on your fine-tune, then compare the two on the same set. Runs on the server, so the page can
 * be closed.
 */
export function VlmEval() {
  const { engines, loading: enginesLoading } = useEngines();
  const [engineSel, setEngineSel] = useState("");
  const [modelSel, setModelSel] = useState("");
  const [maxTokens, setMaxTokens] = useState("256");
  const [sets, setSets] = useState<VlmEvalSet[]>([]);
  const [setSel, setSetSel] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [runs, setRuns] = useState<VlmEvalRunSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<VlmEvalRun | null>(null);
  const [compareId, setCompareId] = useState("");
  const [compareRun, setCompareRun] = useState<VlmEvalRun | null>(null);
  const attached = useRef(false);

  // The picks fall back to the first sensible value until a person chooses one.
  const usable = engines.filter((e) => e.configured && e.available);
  const engine = usable.find((e) => e.id === engineSel) ?? usable.find((e) => e.id === "vllm") ?? usable[0];
  const models = (engine?.models ?? []).filter((m) => m.vision !== false);
  const hiddenTextOnly = (engine?.models.length ?? 0) - models.length;
  const model = models.find((m) => m.id === modelSel)?.id ?? models[0]?.id ?? "";
  const setId = sets.find((s) => s.id === setSel)?.id ?? sets[0]?.id ?? "";
  const selectedSet = sets.find((s) => s.id === setId);

  const loadRuns = useCallback(async () => {
    try {
      const d = (await (await fetch("/api/evals/vlm", { cache: "no-store" })).json()) as { runs?: VlmEvalRunSummary[]; sets?: VlmEvalSet[] };
      const list = d.runs ?? [];
      setRuns(list);
      setSets(d.sets ?? []);
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
        const d = (await (await fetch(`/api/evals/vlm/${activeId}`, { cache: "no-store" })).json()) as { run?: VlmEvalRun };
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
    fetch(`/api/evals/vlm/${compareId}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<{ run?: VlmEvalRun }>)
      .then((d) => !cancelled && setCompareRun(d.run ?? null))
      .catch(() => !cancelled && setCompareRun(null));
    return () => {
      cancelled = true;
    };
  }, [compareId]);

  const start = async () => {
    if (!engine) return;
    setStarting(true);
    setError(null);
    setActive(null);
    try {
      const res = await fetch("/api/evals/vlm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine: engine.id, model, setId, maxTokens: Number(maxTokens) || 256 }),
      });
      const data = (await res.json()) as { runId?: string; error?: string };
      if (!res.ok || !data.runId) throw new Error(data.error || `Failed to start the eval (${res.status})`);
      setCompareId("");
      setCompareRun(null);
      setActiveId(data.runId);
      void loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start the eval");
    } finally {
      setStarting(false);
    }
  };

  const removeRun = async (id: string) => {
    await fetch(`/api/evals/vlm/${id}`, { method: "DELETE" }).catch(() => {});
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

  const removeSet = async (id: string) => {
    const res = await fetch(`/api/evals/vlm/sets/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) setError("Could not delete the test set");
    void loadRuns();
  };

  const running = active?.status === "running";
  const comparable = runs.filter((r) => r.status === "done" && r.id !== activeId && active && r.setId === active.setId);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-1.5">
          <Eye className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold text-primary">Vision eval (your own images)</h2>
          <InfoTip label="About vision eval">
            Each row of a test set is an image, a question and the right answer. The model that is <strong>served right now</strong>{" "}
            answers every row and the answer is scored by the set&apos;s rule. Run it on the base model and on your fine-tune, then
            compare them on the same set. Two requests run at a time, because the engine is shared with everyone else using it.
          </InfoTip>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">Engine</span>
            <select
              value={engine?.id ?? ""}
              onChange={(e) => {
                setEngineSel(e.target.value);
                setModelSel("");
              }}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
            >
              {enginesLoading ? <option value="">Loading…</option> : null}
              {!enginesLoading && usable.length === 0 ? <option value="">No engine is reachable</option> : null}
              {usable.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">Model (served)</span>
            <select value={model} onChange={(e) => setModelSel(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]">
              {models.length === 0 ? <option value="">{engine ? "No vision model is served" : "—"}</option> : null}
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.parent ? ` (adapter of ${m.parent})` : ""}
                  {m.vision ? " · vision" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">Test set</span>
            <select value={setId} onChange={(e) => setSetSel(e.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]">
              {sets.length === 0 ? <option value="">No test set yet</option> : null}
              {sets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.rows} rows
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">Longest answer (tokens)</span>
            <Input type="number" min={1} max={4096} value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)} />
          </label>
        </div>

        {engine && hiddenTextOnly > 0 ? (
          <p className="mt-2 text-[11px] text-ink-soft">{hiddenTextOnly} text-only model{hiddenTextOnly > 1 ? "s are" : " is"} hidden: they cannot read images.</p>
        ) : null}
        {!enginesLoading && usable.length > 0 && models.length === 0 ? (
          <p className="mt-2 text-[12px] text-ink-soft">
            Nothing to grade yet: serve a vision model in{" "}
            <a href="/serve" className="font-medium text-primary hover:underline">
              Deployments
            </a>
            .
          </p>
        ) : null}
        {selectedSet ? <p className="mt-2 text-[11px] text-ink-soft">Scoring: {VLM_SCORING_LABEL[selectedSet.scoring]}.</p> : null}

        <div className="mt-3 space-y-2">
          <AddTestSet
            onAdded={(s) => {
              setSets((cur) => [s, ...cur.filter((x) => x.id !== s.id)]);
              setSetSel(s.id);
              void loadRuns();
            }}
          />
          <SetList sets={sets} selectedId={setId} onDelete={removeSet} />
        </div>

        {error ? (
          <div role="alert" className="mt-3 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-3">
          <Button type="button" onClick={start} disabled={starting || running || !model || !setId || !engine}>
            {starting || running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {running ? "Running…" : "Run eval"}
          </Button>
          {selectedSet ? <span className="text-[11px] text-ink-soft">Sends {selectedSet.rows} images to the model.</span> : null}
        </div>
      </div>

      {active ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-primary">Result</h3>
            <span className="font-mono text-[11px] text-ink-soft">{active.model}</span>
            <span className="text-[11px] text-ink-faint">on {active.setName} · {active.engine}</span>
          </div>
          {active.status === "running" ? (
            <div role="status" className="space-y-1">
              <Progress value={active.progress.total ? (active.progress.completed / active.progress.total) * 100 : 0} className="h-1.5" />
              <p className="text-[11px] text-ink-soft">
                {active.progress.completed} of {active.progress.total} rows answered
                {active.progress.completed - active.progress.errors > 0
                  ? ` · ${pct(active.progress.correct / (active.progress.completed - active.progress.errors), 0)} right so far`
                  : ""}
                {active.progress.errors > 0 ? ` · ${active.progress.errors} request errors` : ""}…
              </p>
            </div>
          ) : active.status === "done" ? (
            <Report run={active} />
          ) : (
            <div role="alert" className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
              {active.status === "interrupted" ? "This run was interrupted (the app restarted). Run it again." : active.error || "The eval failed."}
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
              <option value="">Choose a run (A, the baseline)…</option>
              {comparable.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.model} · {when(r.startedAt)}
                </option>
              ))}
            </select>
          </label>
          {compareRun ? <Compare a={compareRun} b={active} /> : null}
        </div>
      ) : null}

      <History runs={runs} activeId={activeId} onOpen={setActiveId} onDelete={removeRun} />
    </div>
  );
}
