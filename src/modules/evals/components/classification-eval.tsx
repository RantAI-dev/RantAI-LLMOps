"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Grid3x3, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/tooltip";
import { S3EvalSetLoader } from "@/modules/evals/components/s3-eval-set-loader";
import type { ClassEvalRun, ClassEvalRunSummary } from "@/lib/classification-eval-store";
import {
  DEFAULT_CLASSIFICATION_PROMPT,
  type ClassCase,
  type ClassificationReport,
} from "@/lib/classification-eval";
import { cn } from "@/lib/utils";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const STATUS_LABEL: Record<ClassEvalRun["status"], string> = {
  running: "running",
  done: "done",
  error: "failed",
  interrupted: "interrupted",
};

/** One headline metric (all four are higher-is-better here). */
function Metric({ label, value }: { label: string; value: number }) {
  const good = value >= 0.8;
  const bad = value < 0.5;
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-[11px] font-medium text-ink-soft">{label}</div>
      <div className={cn("mt-0.5 text-xl font-semibold tabular-nums", good ? "text-success" : bad ? "text-danger" : "text-ink")}>
        {pct(value)}
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn("h-full rounded-full", good ? "bg-success" : bad ? "bg-danger" : "bg-primary")}
          style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
        />
      </div>
    </div>
  );
}

function ConfusionMatrix({ report }: { report: ClassificationReport }) {
  const { labels, confusion } = report;
  const max = Math.max(1, ...confusion.flat());
  const short = (l: string) => (l.length > 10 ? `${l.slice(0, 9)}…` : l);
  return (
    <div className="overflow-x-auto">
      <table className="border-separate text-[11px]" style={{ borderSpacing: "2px" }}>
        <thead>
          <tr>
            <th className="px-1 pb-1 text-right align-bottom text-[10px] font-normal text-ink-faint">true \ pred</th>
            {labels.map((l) => (
              <th key={l} className="px-1 pb-1 align-bottom font-medium text-ink-soft" title={l}>
                <div className="mx-auto w-6 -rotate-45 origin-bottom-left whitespace-nowrap text-left">{short(l)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((rowLabel, i) => (
            <tr key={rowLabel}>
              <th className="whitespace-nowrap px-1.5 text-right font-medium text-ink" title={rowLabel}>
                {short(rowLabel)}
              </th>
              {labels.map((colLabel, j) => {
                const v = confusion[i][j];
                const a = v === 0 ? 0 : 0.14 + 0.82 * (v / max);
                const hot = v / max > 0.5;
                return (
                  <td
                    key={colLabel}
                    title={`true ${rowLabel} · predicted ${colLabel}: ${v}`}
                    className={cn(
                      "size-7 rounded text-center tabular-nums",
                      i === j && "ring-1 ring-primary/60",
                      hot ? "text-white" : "text-ink"
                    )}
                    style={{ background: `rgba(13, 148, 136, ${a})` }}
                  >
                    {v || ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Report({ report }: { report: ClassificationReport }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Accuracy" value={report.accuracy} />
        <Metric label="Macro-F1" value={report.macroF1} />
        <Metric label="Precision (macro)" value={report.macroPrecision} />
        <Metric label="Recall (macro)" value={report.macroRecall} />
      </div>

      {report.unknownCount > 0 ? (
        <div className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-[12px] text-warning">
          {report.unknownCount} replies had no recognisable label (counted as wrong). If this is high, the
          model isn&apos;t answering with a clean label — a system prompt like the default usually fixes it.
        </div>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[12px]">
            <thead className="bg-surface-2 text-ink-soft">
              <tr>
                {["Class", "Precision", "Recall", "F1", "Support"].map((h) => (
                  <th key={h} className="px-3 py-1.5 text-left font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.labels.map((l) => {
                const c = report.perClass[l];
                return (
                  <tr key={l} className="border-t border-border">
                    <td className="px-3 py-1.5 font-medium text-ink" title={l}>{l}</td>
                    <td className="px-3 py-1.5 tabular-nums">{pct(c.precision)}</td>
                    <td className="px-3 py-1.5 tabular-nums">{pct(c.recall)}</td>
                    <td className="px-3 py-1.5 tabular-nums">{pct(c.f1)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-ink-soft">{c.support}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-medium text-ink-soft">
            <Grid3x3 className="size-3.5" aria-hidden /> Confusion matrix
          </div>
          <ConfusionMatrix report={report} />
        </div>
      </div>
    </div>
  );
}

function Failures({ cases }: { cases: ClassCase[] }) {
  const [open, setOpen] = useState(false);
  const failed = cases.filter((c) => !c.correct);
  if (failed.length === 0) {
    return <p className="text-[12px] text-success">No misclassifications — every row correct.</p>;
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[12px] font-medium text-ink-soft hover:text-ink"
      >
        {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
        {failed.length} misclassified — view details
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {failed.slice(0, 100).map((c, i) => (
            <div key={i} className="rounded-lg border border-border bg-background p-2.5 text-[12px]">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-success-soft px-1.5 py-0.5 text-[10px] font-semibold text-success">
                  true: {c.expected}
                </span>
                <span className="rounded bg-danger-soft px-1.5 py-0.5 text-[10px] font-semibold text-danger">
                  predicted: {c.predicted}
                </span>
              </div>
              <p className="text-ink-soft">
                <span className="font-medium text-ink">Input:</span> {c.instruction.slice(0, 220)}
                {c.instruction.length > 220 ? "…" : ""}
              </p>
              <p className="mt-1 text-ink-soft">
                <span className="font-medium text-ink">Model reply:</span>{" "}
                {c.actual.trim().slice(0, 160) || <em>(empty)</em>}
              </p>
            </div>
          ))}
          {failed.length > 100 ? (
            <p className="text-[11px] text-ink-faint">…and {failed.length - 100} more.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function History({
  runs,
  activeId,
  onOpen,
  onDelete,
}: {
  runs: ClassEvalRunSummary[];
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
              {["Time", "Model", "Status", "Accuracy", "Macro-F1", ""].map((h) => (
                <th key={h} className="px-3 py-1.5 text-left font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr
                key={r.id}
                onClick={() => onOpen(r.id)}
                className={cn(
                  "cursor-pointer border-t border-border hover:bg-surface-2",
                  r.id === activeId && "bg-primary-soft/40"
                )}
              >
                <td className="px-3 py-1.5 whitespace-nowrap text-ink-soft">
                  {new Date(r.createdAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                </td>
                <td className="max-w-[16rem] truncate px-3 py-1.5 font-mono text-[11px] text-ink">{r.model}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-medium",
                      r.status === "done"
                        ? "bg-success-soft text-success"
                        : r.status === "running"
                          ? "bg-primary-soft text-primary"
                          : "bg-danger-soft text-danger"
                    )}
                  >
                    {STATUS_LABEL[r.status]}
                    {r.status === "running" ? ` ${r.completed}/${r.total}` : ""}
                  </span>
                </td>
                <td className="px-3 py-1.5 tabular-nums">{r.report ? pct(r.report.accuracy) : "—"}</td>
                <td className="px-3 py-1.5 tabular-nums">{r.report ? pct(r.report.macroF1) : "—"}</td>
                <td className="px-3 py-1.5">
                  <button
                    type="button"
                    aria-label="Delete run"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(r.id);
                    }}
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

/**
 * Classification eval: replay a held-out test set against a SERVED model and read
 * Accuracy / Macro-F1 / per-class Precision-Recall + a confusion matrix. Run it on
 * the base model too for a before/after comparison. Runs server-side — you can
 * leave the page.
 */
export function ClassificationEval() {
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [jsonl, setJsonl] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_CLASSIFICATION_PROMPT);
  const [maxTokens, setMaxTokens] = useState(24);
  const [starting, setStarting] = useState(false);
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [runs, setRuns] = useState<ClassEvalRunSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<ClassEvalRun | null>(null);
  const attached = useRef(false);

  const loadRuns = useCallback(async () => {
    try {
      const d = (await (await fetch("/api/evals/classification", { cache: "no-store" })).json()) as {
        runs?: ClassEvalRunSummary[];
      };
      const list = d.runs ?? [];
      setRuns(list);
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
    fetch("/api/serve/info", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ models?: Array<{ id: string }> }>)
      .then((d) => {
        const ids = (d.models ?? []).map((m) => m.id);
        setModels(ids);
        setModel((cur) => cur || ids[0] || "");
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot load on mount; state is set only after the request resolves, and this reattaches to a run still in flight
    void loadRuns();
  }, [loadRuns]);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const d = (await (await fetch(`/api/evals/classification/${activeId}`, { cache: "no-store" })).json()) as {
          run?: ClassEvalRun;
        };
        if (cancelled || !d.run) return;
        setActive(d.run);
        if (d.run.status === "running") {
          timer = setTimeout(tick, 2000);
        } else {
          void loadRuns();
        }
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

  const readFile = useCallback((file: File) => {
    file.text().then(setJsonl).catch(() => setError("Failed to read file"));
  }, []);

  const rows = jsonl.split(/\r?\n/).filter((l) => l.trim()).length;

  const start = async () => {
    setStarting(true);
    setError(null);
    setActive(null);
    try {
      const res = await fetch("/api/evals/classification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, jsonl, systemPrompt, maxTokens }),
      });
      const data = (await res.json()) as { runId?: string; error?: string };
      if (!res.ok || !data.runId) throw new Error(data.error || `Failed to start eval (${res.status})`);
      setActiveId(data.runId);
      void loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start eval");
    } finally {
      setStarting(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/evals/classification/${id}`, { method: "DELETE" }).catch(() => {});
    if (id === activeId) {
      setActiveId(null);
      setActive(null);
    }
    void loadRuns();
  };

  const recompute = async (id: string) => {
    setRecomputing(true);
    setError(null);
    try {
      const res = await fetch(`/api/evals/classification/${id}`, { method: "POST" });
      const data = (await res.json()) as { run?: ClassEvalRun; error?: string };
      if (!res.ok || !data.run) throw new Error(data.error || "Failed to recompute");
      setActive(data.run);
      void loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to recompute");
    } finally {
      setRecomputing(false);
    }
  };

  const running = active?.status === "running";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-1.5">
          <Grid3x3 className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold text-primary">Classification eval</h2>
          <InfoTip label="About classification eval">
            Replay a <strong>held-out test set</strong> (<code>instruction</code> = input,{" "}
            <code>output</code> = the true label) against a served model and read{" "}
            <strong>Accuracy, Macro-F1, per-class Precision/Recall</strong> and a confusion matrix. Run it
            on the <strong>base model</strong> too for a before/after figure. Runs on the server — you can
            leave the page.
          </InfoTip>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">Model (served)</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
            >
              {models.length === 0 ? <option value="">No models in Ollama yet</option> : null}
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">
              Test set (JSONL) {rows > 0 ? <span className="text-ink-soft">· {rows} rows</span> : null}
            </span>
            <span className="inline-flex h-9 w-full cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-2 text-[13px] text-ink-soft hover:bg-surface-2">
              <Upload className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">Choose test.jsonl file…</span>
              <input
                type="file"
                accept=".jsonl,.json,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) readFile(f);
                }}
              />
            </span>
          </label>
        </div>

        <div className="mt-3">
          <S3EvalSetLoader onLoad={setJsonl} />
        </div>

        <label className="mt-3 block">
          <span className="mb-1 block text-[13px] font-medium text-ink">
            Test set content{" "}
            <span className="text-ink-soft">(instruction + output=label, paste directly)</span>
          </span>
          <textarea
            value={jsonl}
            onChange={(e) => setJsonl(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder='{"instruction":"Klasifikasikan ...","output":"Emotet"}'
            className="w-full rounded-md border border-input bg-background p-2 font-mono text-[11px] leading-4 outline-none focus:border-primary"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-[13px] font-medium text-ink">System prompt</span>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={3}
            spellCheck={false}
            className="w-full rounded-md border border-input bg-background p-2 font-mono text-[11px] leading-4 outline-none focus:border-primary"
          />
          <span className="mt-1 block text-[11px] text-ink-soft">
            Leave empty to test the model <strong>without</strong> any prompt — the difference shows how
            much the prompt contributes vs the fine-tune.
          </span>
        </label>

        <label className="mt-3 block max-w-[16rem]">
          <span className="mb-1 block text-[13px] font-medium text-ink">Answer token limit</span>
          <input
            type="number"
            min={8}
            step={8}
            value={maxTokens}
            onChange={(e) => setMaxTokens(Number(e.target.value))}
            onBlur={() => setMaxTokens((v) => (Number.isFinite(v) && v >= 8 ? v : 24))}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
          />
          <span className="mt-1 block text-[11px] leading-4 text-ink-soft">
            A label is one short token — keep this small so the eval runs fast.
          </span>
        </label>

        {error ? (
          <div className="mt-3 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-3">
          <Button type="button" onClick={start} disabled={starting || running || !model || rows === 0}>
            {starting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {running ? "Running…" : starting ? "Starting…" : "Run eval"}
          </Button>
          <p className="text-[12px] text-ink-soft">
            {rows > 0 ? `${rows} rows` : "Choose or paste a test set first"}
          </p>
        </div>
      </div>

      {active ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-primary">{running ? "Running" : "Results"}</h3>
            <div className="flex items-center gap-2">
              {!running && active.cases?.length ? (
                <button
                  type="button"
                  onClick={() => recompute(active.id)}
                  disabled={recomputing}
                  title="Rescore stored replies with the current parser — without calling the model again"
                  className="inline-flex items-center gap-1 rounded border border-hairline-2 bg-surface-2 px-2 py-1 text-[11px] font-medium text-ink-soft hover:bg-primary-soft hover:text-primary disabled:opacity-60"
                >
                  <RefreshCw className={cn("size-3", recomputing && "animate-spin")} aria-hidden />
                  {recomputing ? "Computing…" : "Recompute"}
                </button>
              ) : null}
              <span className="font-mono text-[11px] text-ink-soft">{active.model}</span>
            </div>
          </div>

          {running ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-[12px] text-ink-soft">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {active.completed} / {active.total} rows — you can leave; the results stay saved.
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-surface-2">
                <div
                  className="h-full bg-primary transition-[width] duration-500"
                  style={{ width: `${Math.round((active.completed / Math.max(1, active.total)) * 100)}%` }}
                />
              </div>
            </div>
          ) : null}

          {active.status === "interrupted" || active.status === "error" ? (
            <div className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[12px] text-danger">
              {active.error ?? "Run failed."}
            </div>
          ) : null}

          {active.errorCount > 0 ? (
            <div className="mb-3 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-[12px] text-warning">
              {active.errorCount} requests failed and were scored as empty replies — the numbers below are
              worse than reality. Run it again. ({active.errorSample})
            </div>
          ) : null}

          {active.report ? (
            <>
              <Report report={active.report} />
              {active.cases ? (
                <div className="mt-3 border-t border-border pt-3">
                  <Failures cases={active.cases} />
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <History runs={runs} activeId={activeId} onOpen={setActiveId} onDelete={remove} />
    </div>
  );
}
