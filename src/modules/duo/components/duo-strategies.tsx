"use client";

import { Play, Square } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { DuoDataset, DuoEvalRun, DuoStrategyPoint } from "@/lib/duo-evals";
import { cn } from "@/lib/utils";

/** The strategies offered, in the gateway's naming. λ is the price of waiting relative to an error. */
const STRATEGIES: Array<{ id: string; label: string; hint: string }> = [
  { id: "fast_only", label: "System 1 only", hint: "The small model answers everything" },
  { id: "slow_only", label: "System 2 always", hint: "The reasoning model answers everything" },
  { id: "nafs_aql", label: "Gate (default λ)", hint: "System 1 drafts; the gate decides" },
  { id: "nafs_aql_l05", label: "Gate, λ 0.05", hint: "Escalates more often" },
  { id: "nafs_aql_l10", label: "Gate, λ 0.10", hint: "" },
  { id: "nafs_aql_l40", label: "Gate, λ 0.40", hint: "" },
  { id: "nafs_aql_l60", label: "Gate, λ 0.60", hint: "Escalates less often" },
  { id: "pre_route", label: "Router before answering", hint: "System 1 reads the question and picks the model before anything is answered (Semantic Router style)" },
];
const DEFAULT_STRATEGIES = ["fast_only", "slow_only", "nafs_aql"];

const pct = (x: number | null, d = 1) => (x === null ? "–" : `${(x * 100).toFixed(d)}%`);
const secs = (s: number | null) => (s === null ? "–" : s < 10 ? `${s.toFixed(1)} s` : `${Math.round(s)} s`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

/** The one-sentence finding: the best gate against "System 2 always", when both ran. */
export function finding(points: DuoStrategyPoint[]): string | null {
  const slow = points.find((p) => p.system === "slow_only");
  const gates = points.filter((p) => (p.system.startsWith("nafs_") || p.system === "pre_route") && p.accuracy !== null && p.meanCostS !== null);
  if (!slow || slow.accuracy === null || slow.meanCostS === null || !gates.length) return null;
  const best = [...gates].sort((a, b) => b.accuracy! - a.accuracy! || a.meanCostS! - b.meanCostS!)[0];
  const share = best.meanCostS! / slow.meanCostS;
  const esc = best.escalationRate !== null ? `; System 2 answered ${pct(best.escalationRate, 0)} of questions` : "";
  return `${best.label}: ${pct(best.accuracy)} accuracy against ${pct(slow.accuracy)} for System 2 always, at ${pct(share, 0)} of its time${esc}.`;
}

// ---------------------------------------------------------------------------------------------------
// Chart: accuracy (y) against seconds per question (x); the Pareto frontier joined; 95% intervals as whiskers.
// ---------------------------------------------------------------------------------------------------
const W = 520;
const H = 300;
const M = { l: 48, r: 16, t: 14, b: 40 };

export function FrontierChart({ points }: { points: DuoStrategyPoint[] }) {
  const pts = points.filter((p) => p.accuracy !== null && p.meanCostS !== null);
  if (!pts.length) return null;
  const xMax = Math.max(...pts.map((p) => p.meanCostS!)) * 1.12 || 1;
  const lows = pts.map((p) => p.ci?.[0] ?? p.accuracy!);
  const yMin = Math.max(0, Math.floor(Math.min(...lows) * 10) / 10 - 0.05);
  const px = (s: number) => M.l + (s / xMax) * (W - M.l - M.r);
  const py = (a: number) => M.t + (1 - (a - yMin) / (1 - yMin)) * (H - M.t - M.b);
  const yTicks = Array.from({ length: 6 }, (_, i) => yMin + ((1 - yMin) * i) / 5);
  const xTicks = Array.from({ length: 5 }, (_, i) => (xMax * i) / 4);
  const front = pts.filter((p) => p.pareto).sort((a, b) => a.meanCostS! - b.meanCostS!);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Accuracy against seconds per question, per strategy" className="w-full max-w-[620px]">
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={M.l} x2={W - M.r} y1={py(t)} y2={py(t)} className="stroke-hairline" strokeWidth={1} />
          <text x={M.l - 6} y={py(t) + 4} textAnchor="end" className="fill-ink-soft text-[10px]">
            {Math.round(t * 100)}%
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={`x${t}`} x={px(t)} y={H - M.b + 16} textAnchor="middle" className="fill-ink-soft text-[10px]">
          {secs(t)}
        </text>
      ))}
      <text x={(M.l + W - M.r) / 2} y={H - 6} textAnchor="middle" className="fill-ink-soft text-[11px]">
        Mean time per question (lower is cheaper)
      </text>
      <text x={12} y={(M.t + H - M.b) / 2} textAnchor="middle" transform={`rotate(-90 12 ${(M.t + H - M.b) / 2})`} className="fill-ink-soft text-[11px]">
        Accuracy
      </text>
      {front.length > 1 && (
        <polyline points={front.map((p) => `${px(p.meanCostS!)},${py(p.accuracy!)}`).join(" ")} fill="none" className="stroke-primary" strokeWidth={1.5} strokeDasharray="4 3" />
      )}
      {pts.map((p) => (
        <g key={p.system}>
          {p.ci && <line x1={px(p.meanCostS!)} x2={px(p.meanCostS!)} y1={py(p.ci[0])} y2={py(p.ci[1])} className="stroke-ink-faint" strokeWidth={1} />}
          <circle cx={px(p.meanCostS!)} cy={py(p.accuracy!)} r={4.5} className={cn("stroke-primary", p.pareto ? "fill-primary" : "fill-surface")} strokeWidth={1.5}>
            <title>{`${p.label}: ${pct(p.accuracy)} right, ${secs(p.meanCostS)} per question${p.pareto ? " (on the frontier)" : ""}`}</title>
          </circle>
          <text x={px(p.meanCostS!) + 7} y={py(p.accuracy!) - 7} className="fill-ink text-[10px]">
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function PointsTable({ points }: { points: DuoStrategyPoint[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-hairline">
      <table className="w-full text-[12px]">
        <thead className="bg-surface-2 text-ink-soft">
          <tr>
            {["Strategy", "Accuracy (95% interval)", "Time / question", "vs System 2 always", "System 2 used", "Model calls", "Questions"].map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-1.5 text-left font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.system} className="border-t border-hairline">
              <td className="whitespace-nowrap px-3 py-1.5">
                {p.label}
                {p.pareto && <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">frontier</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-1.5">
                {pct(p.accuracy)}
                {p.ci && <span className="text-ink-soft"> ({pct(p.ci[0], 0)}–{pct(p.ci[1], 0)})</span>}
              </td>
              <td className="px-3 py-1.5">{secs(p.meanCostS)}</td>
              <td className="px-3 py-1.5">{pct(p.costVsSlow, 0)}</td>
              <td className="px-3 py-1.5">{pct(p.escalationRate, 0)}</td>
              <td className="px-3 py-1.5">{p.meanModelCalls === null ? "–" : p.meanModelCalls.toFixed(1)}</td>
              <td className="px-3 py-1.5">{p.n ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------
// Page section
// ---------------------------------------------------------------------------------------------------
export function DuoStrategies() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [datasets, setDatasets] = useState<DuoDataset[]>([]);
  const [runs, setRuns] = useState<DuoEvalRun[]>([]);
  const [selected, setSelected] = useState<DuoEvalRun | null>(null);
  const [benchmark, setBenchmark] = useState("gsm8k");
  const [items, setItems] = useState(30);
  const [systems, setSystems] = useState<string[]>(DEFAULT_STRATEGIES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/duo/evals")
      .then(async (res) => {
        const j = (await res.json()) as { configured?: boolean; datasets?: DuoDataset[]; runs?: DuoEvalRun[]; error?: string };
        if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
        return j;
      })
      .then((j) => {
        if (!alive) return;
        setConfigured(Boolean(j.configured));
        setDatasets(j.datasets ?? []);
        setRuns(j.runs ?? []);
        setSelected((cur) => cur ?? j.runs?.find((r) => r.points.length) ?? null);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setConfigured((c) => c ?? false);
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  // Follow a running comparison until it finishes.
  const runningId = selected?.status === "running" ? selected.id : null;
  useEffect(() => {
    if (!runningId) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/duo/evals/${runningId}`);
        if (!res.ok) return;
        const run = (await res.json()) as DuoEvalRun;
        setSelected(run);
        setRuns((rs) => rs.map((r) => (r.id === run.id ? run : r)));
      } catch {
        /* try again on the next tick */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [runningId]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/duo/evals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ benchmark, systems, maxItems: items }),
      });
      const j = (await res.json()) as DuoEvalRun & { error?: string };
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setRuns((rs) => [j, ...rs]);
      setSelected(j);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setError(null);
    const res = await fetch(`/api/duo/evals/${id}/cancel`, { method: "POST" });
    if (!res.ok) setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
  }

  if (configured === false && !error) {
    return (
      <div className="rounded-lg border border-hairline bg-card p-6 text-sm text-muted-foreground">
        The Duo gateway is not configured. Set DUO_GATEWAY_URL and DUO_GATEWAY_TOKEN on the frontend (see docs/RENCANA-DUO.md).
      </div>
    );
  }

  const toggle = (id: string) => setSystems((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const text = selected ? finding(selected.points) : null;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-hairline bg-card p-4">
        <p className="mb-3 text-[13px] text-ink-soft">
          Runs the same questions through each strategy on the Rantai-Aql gateway, which scores the answers. A good gate sits near System 2&apos;s
          accuracy at a fraction of its time.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">Dataset</span>
            <select value={benchmark} onChange={(e) => setBenchmark(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-[13px]">
              {datasets.length === 0 && <option value="gsm8k">gsm8k</option>}
              {datasets.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name} ({d.tasks} questions{d.domains.length ? `, ${d.domains.join("/")}` : ""})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">Questions</span>
            <input
              type="number"
              min={1}
              max={200}
              value={items}
              onChange={(e) => setItems(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
              className="h-9 w-24 rounded-md border border-input bg-background px-2 text-[13px]"
            />
          </label>
          <Button onClick={start} disabled={busy || systems.length === 0}>
            <Play className="mr-1 h-4 w-4" />
            {busy ? "Starting…" : "Compare"}
          </Button>
        </div>
        <fieldset className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          <legend className="sr-only">Strategies</legend>
          {STRATEGIES.map((s) => (
            <label key={s.id} className="flex items-center gap-1.5 text-[12px]" title={s.hint}>
              <input type="checkbox" checked={systems.includes(s.id)} onChange={() => toggle(s.id)} />
              {s.label}
            </label>
          ))}
        </fieldset>
        <p className="mt-2 text-[11px] text-ink-soft">
          Questions run one at a time. On the GB10, System 2 takes about 30 s per GSM8K question and several minutes per coding question, so a
          comparison with System 2 always can take from 15 minutes to a few hours.
        </p>
      </div>

      {error && <div className="rounded-lg border border-hairline px-4 py-2 text-xs text-destructive">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <ul className="space-y-1" aria-label="Comparisons">
          {runs.length === 0 && <li className="text-[12px] text-ink-soft">No comparison yet.</li>}
          {runs.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSelected(r)}
                className={cn("w-full rounded-md border px-3 py-2 text-left text-[12px]", selected?.id === r.id ? "border-primary bg-muted" : "border-hairline")}
              >
                <div className="font-medium">
                  {r.benchmark} · {r.maxItems ?? "?"} questions
                </div>
                <div className="text-ink-soft">
                  {r.status === "running" ? `running ${r.progress.done}/${r.progress.total}` : r.status} · {when(r.startedAt)}
                </div>
              </button>
            </li>
          ))}
        </ul>

        {selected ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="font-medium">
                {selected.benchmark} · {selected.systems.length} strategies
              </span>
              {selected.status === "running" && (
                <>
                  <span className="text-ink-soft">
                    {selected.progress.done}/{selected.progress.total} answers
                  </span>
                  <Button variant="outline" size="sm" onClick={() => cancel(selected.id)}>
                    <Square className="mr-1 h-3 w-3" />
                    Stop
                  </Button>
                </>
              )}
              {selected.error && <span className="text-destructive">{selected.error}</span>}
            </div>
            {text && <p className="text-[13px] text-ink">{text}</p>}
            {selected.points.length > 0 ? (
              <>
                <FrontierChart points={selected.points} />
                <PointsTable points={selected.points} />
              </>
            ) : (
              <p className="text-[12px] text-ink-soft">Results appear when the run finishes.</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
