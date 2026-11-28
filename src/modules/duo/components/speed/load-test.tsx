"use client";

import { Play, Square } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { GwErrorState, Loading, Meter, Note, Panel, Pill, Spinner, Stat, StatGrid, arr, fmtAgo, fmtInt, fmtMs, fmtNum, fmtPct, rec, str } from "@/modules/duo/components/duo-ui";
import { useRun } from "@/modules/duo/components/experiments/use-run";
import { GwError, gw } from "@/modules/duo/lib/gw";

export const SELECT_CLASS =
  "h-8 rounded-[var(--radius-md)] border border-input bg-background px-2 text-sm text-ink outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20";
export const TH = "whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-ink-soft";
export const TD = "px-3 py-2";

/** Friendly names for the gateway's built-in prompt sets (it sends its own label too). */
const SET_NAME: Record<string, string> = { "chat-short": "Short chat questions", math: "Word problems (often need System 2)", mixed: "Mixed: maths, code, facts, open questions" };
export const setName = (k: string, label?: unknown) => SET_NAME[k] ?? (typeof label === "string" && label ? label : k);
export const MODES = [
  { id: "fast", label: "System 1 only" },
  { id: "auto", label: "Auto (the gate decides)" },
  { id: "slow", label: "System 2 always" },
];
export const modeLabel = (m: unknown) => MODES.find((x) => x.id === m)?.label ?? (typeof m === "string" && m ? m : "–");

const STOPS = [
  { id: "r:6", label: "6 questions" },
  { id: "r:12", label: "12 questions" },
  { id: "r:24", label: "24 questions" },
  { id: "r:60", label: "60 questions" },
  { id: "d:60", label: "60 seconds" },
  { id: "d:300", label: "5 minutes" },
  { id: "d:900", label: "15 minutes" },
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

/** An answer length the gateway accepts: a whole number of tokens from 16 to 2048. */
export const clampTokens = (v: string) => Math.max(16, Math.min(2048, Math.round(Number(v)) || 16));

export type PromptSets = Record<string, { label?: string; prompts?: unknown[] }>;

/** Start a load test: simulated users ask questions one after another through the full service. */
export function LoadTestForm({
  sets,
  running,
  onStarted,
  promptSet,
  onPromptSet,
  maxTokens,
  onMaxTokens,
}: {
  sets: PromptSets;
  running: boolean;
  onStarted: (id: string) => void;
  promptSet: string;
  onPromptSet: (s: string) => void;
  maxTokens: number;
  onMaxTokens: (n: number) => void;
}) {
  const [mode, setMode] = useState("fast");
  const [users, setUsers] = useState(1);
  const [stop, setStop] = useState("r:12");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What is typed in the answer length; it is clamped to 16..2048 only when the field is left or a test starts.
  const [tokensDraft, setTokensDraft] = useState<string | null>(null);
  const keys = Object.keys(sets);
  const commitTokens = () => {
    if (tokensDraft === null) return maxTokens;
    const n = clampTokens(tokensDraft);
    setTokensDraft(null);
    onMaxTokens(n);
    return n;
  };

  async function start() {
    const tokens = commitTokens();
    setBusy(true);
    setError(null);
    const [k, v] = stop.split(":");
    try {
      const body = { prompt_set: promptSet, mode, concurrency: users, max_tokens: tokens, [k === "r" ? "requests" : "duration_s"]: Number(v) };
      const r = await gw<{ run_id?: string }>("/v1/bench/runs", { method: "POST", body });
      if (!r?.run_id) throw new GwError("The gateway did not return a run id", 502);
      toast.success("Load test started");
      onStarted(r.run_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const selected = sets[promptSet];
  return (
    <Panel title="Load test" info="Simulated users send questions one after another through the full service, so the times include routing, checks and both models.">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Questions">
          <select aria-label="Prompt set" value={promptSet} onChange={(e) => onPromptSet(e.target.value)} className={cn(SELECT_CLASS, "min-w-56")}>
            {keys.length === 0 ? <option value={promptSet}>{setName(promptSet)}</option> : null}
            {keys.map((k) => (
              <option key={k} value={k}>
                {setName(k, sets[k]?.label)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Answer mode">
          <select aria-label="Answer mode" value={mode} onChange={(e) => setMode(e.target.value)} className={SELECT_CLASS}>
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Simultaneous users">
          <select aria-label="Simultaneous users" value={users} onChange={(e) => setUsers(Number(e.target.value))} className={SELECT_CLASS}>
            {[1, 2, 4, 8, 16].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Stop after">
          <select aria-label="Stop after" value={stop} onChange={(e) => setStop(e.target.value)} className={SELECT_CLASS}>
            {STOPS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Answer length (tokens)">
          <Input
            aria-label="Answer length"
            type="number"
            min={16}
            max={2048}
            value={tokensDraft ?? String(maxTokens)}
            onChange={(e) => setTokensDraft(e.target.value)}
            onBlur={() => void commitTokens()}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitTokens();
            }}
            className="w-28"
          />
        </Field>
        <Button onClick={start} disabled={busy || running || !promptSet}>
          {busy ? <Spinner className="text-primary-foreground" /> : <Play />}
          {busy ? "Starting…" : "Start"}
        </Button>
      </div>
      {selected?.prompts?.length ? (
        <p className="mt-2 text-xs text-ink-soft">
          {arr<string>(selected.prompts).length} questions, asked in turn, for example: “{String(arr<string>(selected.prompts)[0] ?? "")}”
        </p>
      ) : null}
      {running ? <p className="mt-2 text-xs text-ink-soft">A load test is running; start another once it ends or is cancelled.</p> : null}
      {error ? (
        <Note tone="bad" className="mt-3">
          {error}
        </Note>
      ) : null}
    </Panel>
  );
}

type Sample = { t: number; y: number; ok: boolean; mode: string; ttft: number | null };

/** Time per answer against seconds into the test, with the slowest-5% line. */
function Scatter({ samples, p95 }: { samples: Sample[]; p95: number | null }) {
  if (!samples.length) return <p className="py-6 text-center text-sm text-ink-soft">Answers appear here as they arrive.</p>;
  const W = 640;
  const H = 220;
  const pad = { l: 48, r: 12, t: 10, b: 30 };
  const xmax = Math.max(1, ...samples.map((s) => s.t));
  const ymax = Math.max(1, ...samples.map((s) => s.y), p95 ?? 0) * 1.08;
  const X = (x: number) => pad.l + (x / xmax) * (W - pad.l - pad.r);
  const Y = (y: number) => H - pad.b - (y / ymax) * (H - pad.t - pad.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Time per answer during the test" className="w-full">
      {ticks.map((f) => (
        <g key={f}>
          <line x1={pad.l} x2={W - pad.r} y1={Y(f * ymax)} y2={Y(f * ymax)} className="stroke-hairline" />
          <text x={pad.l - 6} y={Y(f * ymax) + 3} textAnchor="end" className="fill-ink-soft text-[10px]">
            {fmtMs(f * ymax)}
          </text>
          <text x={X(f * xmax)} y={H - 12} textAnchor="middle" className="fill-ink-soft text-[10px]">
            {Math.round(f * xmax)} s
          </text>
        </g>
      ))}
      {p95 !== null ? (
        <g>
          <line x1={pad.l} x2={W - pad.r} y1={Y(p95)} y2={Y(p95)} className="stroke-warning" strokeDasharray="4 3" />
          <text x={W - pad.r} y={Y(p95) - 4} textAnchor="end" className="fill-warning-strong text-[10px]">
            slowest 5%
          </text>
        </g>
      ) : null}
      {samples.map((s, i) => (
        <circle key={i} cx={X(s.t)} cy={Y(s.y)} r={3.6} fillOpacity={0.8} className={!s.ok ? "fill-danger" : s.mode === "slow" ? "fill-primary" : "fill-info"}>
          <title>{`${!s.ok ? "failed" : s.mode === "slow" ? "System 2" : "System 1"} · ${fmtMs(s.y)}${s.ttft ? ` · first words after ${fmtMs(s.ttft)}` : ""}`}</title>
        </circle>
      ))}
      <text x={(W + pad.l) / 2} y={H - 1} textAnchor="middle" className="fill-ink-soft text-[10px]">
        seconds into the test
      </text>
    </svg>
  );
}

const q = (v: unknown) => rec(v);

/** One load test: progress while it runs (polled every 1.5 s until it ends), then response times and throughput. */
export function LoadRun({ runId, onEnded }: { runId: string; onEnded: () => void }) {
  const { data, error, loading, reload, status } = useRun(`/v1/bench/runs/${encodeURIComponent(runId)}`, 1500, onEnded);
  const [cancelling, setCancelling] = useState(false);
  const r = rec(data);

  if (loading && !data) return <Loading label="Loading the load test…" />;
  if (error && !data) return <GwErrorState error={error} onRetry={() => reload(false)} what="this load test" />;
  const req = rec(r.request);
  const x = rec(r.results);
  const total = typeof req.requests === "number" ? req.requests : null;
  const done = typeof x.requests === "number" ? x.requests : 0;
  const elapsed = typeof r.elapsed_s === "number" ? r.elapsed_s : 0;
  const share = total ? done / total : typeof req.duration_s === "number" && req.duration_s > 0 ? elapsed / req.duration_s : 0;
  const isRunning = status === "running";
  const samples: Sample[] = arr(r.samples).map((s) => ({
    t: (typeof s.t_start_ms === "number" ? s.t_start_ms : 0) / 1000,
    y: typeof s.latency_ms === "number" ? s.latency_ms : 0,
    ok: s.ok !== false,
    mode: str(s.mode, "fast"),
    ttft: typeof s.ttft_ms === "number" ? s.ttft_ms : null,
  }));
  const lat = q(x.latency_ms);
  const errors = arr(r.samples).filter((s) => s.ok === false && str(s.error, ""));

  async function cancel() {
    setCancelling(true);
    try {
      await gw(`/v1/bench/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" });
      toast.success("Stopping once the current answers finish…");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setCancelling(false);
    }
  }

  const rows: Array<[string, Record<string, unknown>]> = [
    ["All answers", lat],
    ["System 1", q(x.latency_fast_ms)],
    ["System 2", q(x.latency_slow_ms)],
    ["First words", q(x.ttft_ms)],
  ];
  return (
    <div className="space-y-4">
      <Panel
        title={
          <span className="flex flex-wrap items-center gap-2">
            {setName(str(req.prompt_set, ""))} · {modeLabel(req.mode)} · {fmtInt(req.concurrency)} {req.concurrency === 1 ? "user" : "users"}
            <Pill tone={isRunning ? "info" : status === "cancelled" ? "warn" : status === "done" ? "good" : "neutral"}>
              {isRunning ? <Spinner className="size-3" /> : null}
              {isRunning ? "Running" : status === "cancelled" ? "Cancelled" : status === "done" ? "Finished" : status || "Unknown"}
            </Pill>
          </span>
        }
        actions={
          isRunning ? (
            <Button size="sm" variant="outline" onClick={cancel} disabled={cancelling}>
              <Square /> Cancel
            </Button>
          ) : (
            <span className="text-xs text-ink-soft">{fmtAgo(r.finished_at ?? r.created_at)}</span>
          )
        }
      >
        <div className="space-y-2">
          <Meter value={isRunning ? share : 1} tone={status === "cancelled" ? "warn" : isRunning ? "info" : "good"} label="Load test progress" />
          <p className="text-xs text-ink-soft" aria-live="polite">
            {fmtInt(done)}
            {total ? ` / ${fmtInt(total)}` : ""} questions · {fmtNum(elapsed, 0)} s
            {typeof req.duration_s === "number" ? ` of ${fmtInt(req.duration_s)} s` : ""}
          </p>
          <StatGrid>
            <Stat label="Answered" value={`${fmtInt(x.ok ?? 0)} / ${fmtInt(x.requests ?? 0)}`} hint={`${fmtPct(x.error_rate ?? 0, 1)} failed`} tone={(x.error_rate as number) > 0 ? "warn" : undefined} />
            <Stat label="Answers per minute" value={fmtNum(typeof x.throughput_rps === "number" ? x.throughput_rps * 60 : null, 1)} hint={`${fmtNum(x.tokens_per_s, 1)} tokens written per second`} />
            <Stat label="First words after" value={fmtMs(q(x.ttft_ms).p50)} hint={`slowest 5% ${fmtMs(q(x.ttft_ms).p95)}`} />
            <Stat label="Typical answer time" value={fmtMs(lat.p50)} hint={`p95 ${fmtMs(lat.p95)} · p99 ${fmtMs(lat.p99)} · ${fmtPct(x.escalation_rate)} System 2`} />
          </StatGrid>
          {errors.length ? (
            <Note tone="warn">
              {errors.length} {errors.length === 1 ? "answer" : "answers"} failed, for example: {str(errors[0].error)}
            </Note>
          ) : null}
        </div>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Time per answer"
          actions={
            <span className="flex gap-3 text-xs text-ink-soft">
              <span className="flex items-center gap-1">
                <span className="size-2.5 rounded-full bg-info" aria-hidden /> System 1
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2.5 rounded-full bg-primary" aria-hidden /> System 2
              </span>
              <span className="flex items-center gap-1">
                <span className="size-2.5 rounded-full bg-danger" aria-hidden /> failed
              </span>
            </span>
          }
        >
          <Scatter samples={samples} p95={typeof lat.p95 === "number" ? lat.p95 : null} />
        </Panel>
        <Panel title="Response times" info="p50 is the typical answer; p95 and p99 are the slowest 5% and 1%." bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2">
                <tr>
                  {["", "Count", "Typical (p50)", "p95", "p99", "Average"].map((h) => (
                    <th key={h} className={TH}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(([k, v]) => (
                  <tr key={k} className="border-t border-hairline">
                    <td className={cn(TD, "font-medium")}>{k}</td>
                    <td className={cn(TD, "tabular-nums")}>{fmtInt(v.n ?? 0)}</td>
                    <td className={cn(TD, "tabular-nums")}>{fmtMs(v.p50)}</td>
                    <td className={cn(TD, "tabular-nums")}>{fmtMs(v.p95)}</td>
                    <td className={cn(TD, "tabular-nums")}>{fmtMs(v.p99)}</td>
                    <td className={cn(TD, "tabular-nums")}>{fmtMs(v.mean)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-xs text-ink-soft">
            Throughput {fmtNum(typeof x.throughput_rps === "number" ? x.throughput_rps : null, 2)} answers per second · model time per answer{" "}
            {fmtNum(x.cost_per_request_s, 1)} s.
          </p>
        </Panel>
      </div>
    </div>
  );
}
