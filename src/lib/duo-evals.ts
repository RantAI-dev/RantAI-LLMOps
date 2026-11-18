/**
 * Strategy comparison for the Duo page (docs/RENCANA-DUO.md, phase D2): runs the Rantai-Aql gateway's own eval
 * (`POST /v1/eval/runs`) over several strategies and reads back where each lands on accuracy against cost.
 *
 * The gateway scores the answers, computes the confidence intervals and marks the Pareto frontier; this module only
 * checks what the browser asks for and maps the run to what the page draws. Server-only (uses the gateway token).
 */
import { duoGateway, DuoError } from "@/lib/duo";

/** Strategies the page offers. `nafs_aql_l<NN>` is the gate with λ = NN/100 (the gateway's own naming). */
const FIXED = ["fast_only", "slow_only", "nafs_aql", "nafs_blind", "pre_route"] as const;
const LAMBDA_SYSTEM = /^nafs_aql_l(\d{1,3})$/;
export const DUO_EVAL_MAX_ITEMS = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DuoEvalRequest = { benchmark: string; systems: string[]; maxItems: number; seed?: number };

export function isStrategy(s: string): boolean {
  if ((FIXED as readonly string[]).includes(s)) return true;
  const m = LAMBDA_SYSTEM.exec(s);
  return Boolean(m) && Number(m![1]) <= 100;
}

/** What a strategy is, in words the page shows. */
export function strategyLabel(s: string): string {
  const m = LAMBDA_SYSTEM.exec(s);
  if (m) return `Gate, λ = ${(Number(m[1]) / 100).toFixed(2)}`;
  return (
    { fast_only: "System 1 only", slow_only: "System 2 always", nafs_aql: "Gate (default λ)", nafs_blind: "Gate, checker hidden", pre_route: "Router before answering" }[s] ??
    s
  );
}

/** Checks a browser request body; returns the run to start or throws DuoError(400). */
export function parseDuoEvalRequest(body: unknown): DuoEvalRequest {
  if (!body || typeof body !== "object") throw new DuoError("Invalid JSON body", 400);
  const b = body as { benchmark?: unknown; systems?: unknown; maxItems?: unknown; seed?: unknown };
  if (typeof b.benchmark !== "string" || !/^[a-z0-9_]{1,40}$/.test(b.benchmark)) {
    throw new DuoError("`benchmark` must be a dataset name", 400);
  }
  if (!Array.isArray(b.systems) || b.systems.length < 1 || b.systems.length > 12) {
    throw new DuoError("`systems` must list 1 to 12 strategies", 400);
  }
  const systems = b.systems.map((s, i) => {
    if (typeof s !== "string" || !isStrategy(s)) throw new DuoError(`systems[${i}] is not a strategy`, 400);
    return s;
  });
  if (new Set(systems).size !== systems.length) throw new DuoError("`systems` must not repeat", 400);
  const maxItems = b.maxItems ?? 30;
  if (typeof maxItems !== "number" || !Number.isInteger(maxItems) || maxItems < 1 || maxItems > DUO_EVAL_MAX_ITEMS) {
    throw new DuoError(`\`maxItems\` must be a whole number from 1 to ${DUO_EVAL_MAX_ITEMS}`, 400);
  }
  let seed: number | undefined;
  if (b.seed !== undefined && b.seed !== null) {
    if (typeof b.seed !== "number" || !Number.isInteger(b.seed) || b.seed < 0 || b.seed > 2 ** 31) {
      throw new DuoError("`seed` must be a non-negative whole number", 400);
    }
    seed = b.seed;
  }
  return { benchmark: b.benchmark, systems, maxItems, seed };
}

export type DuoStrategyPoint = {
  system: string;
  label: string;
  accuracy: number | null;
  /** 95% interval on accuracy, when the gateway reports one. */
  ci: [number, number] | null;
  /** Mean seconds per question: the cost axis. */
  meanCostS: number | null;
  /** Cost relative to "System 2 always" (1 = same), when that strategy ran. */
  costVsSlow: number | null;
  pareto: boolean;
  n: number | null;
  escalationRate: number | null;
  meanModelCalls: number | null;
  meanReasoningTokens: number | null;
};

export type DuoEvalRun = {
  id: string;
  status: string;
  benchmark: string;
  maxItems: number | null;
  systems: string[];
  startedAt: string | null;
  finishedAt: string | null;
  progress: { done: number; total: number };
  error: string | null;
  points: DuoStrategyPoint[];
};

export type DuoDataset = { name: string; tasks: number; verifiable: number; domains: string[] };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Marks the points no other point beats on both accuracy and cost (used when the gateway sent no frontier). */
function markPareto(points: DuoStrategyPoint[]): void {
  for (const p of points) {
    if (p.accuracy === null || p.meanCostS === null) continue;
    p.pareto = !points.some(
      (q) =>
        q !== p &&
        q.accuracy !== null &&
        q.meanCostS !== null &&
        q.accuracy >= p.accuracy! &&
        q.meanCostS <= p.meanCostS! &&
        (q.accuracy > p.accuracy! || q.meanCostS < p.meanCostS!)
    );
  }
}

/** Maps a gateway eval run to what the page draws. Missing fields become null, never a crash. */
export function toDuoEvalRun(run: unknown): DuoEvalRun {
  const r = obj(run);
  const req = obj(r.request);
  const systems = obj(r.systems);
  const frontier = Array.isArray(r.frontier) ? r.frontier.map(obj) : [];
  const front = new Map(frontier.map((f) => [str(f.system) ?? "", f]));
  const points: DuoStrategyPoint[] = Object.entries(systems).map(([system, raw]) => {
    const s = obj(raw);
    const f = front.get(system);
    const ci = Array.isArray(s.accuracy_ci95) && s.accuracy_ci95.length === 2 ? s.accuracy_ci95.map(num) : null;
    const wall = num(s.mean_wall_ms);
    return {
      system,
      label: strategyLabel(system),
      accuracy: num(s.accuracy),
      ci: ci && ci[0] !== null && ci[1] !== null ? [ci[0], ci[1]] : null,
      meanCostS: (f && num(f.mean_cost_s)) ?? (wall !== null ? wall / 1000 : null),
      costVsSlow: f ? num(f.cost_vs_slow) : null,
      pareto: f ? f.pareto === true : false,
      n: num(s.n),
      escalationRate: num(s.escalation_rate),
      meanModelCalls: num(s.mean_model_calls),
      meanReasoningTokens: num(s.mean_reasoning_tokens),
    };
  });
  if (!frontier.length) {
    markPareto(points);
    const slow = points.find((p) => p.system === "slow_only")?.meanCostS;
    if (slow) for (const p of points) p.costVsSlow = p.meanCostS !== null ? p.meanCostS / slow : null;
  }
  points.sort((a, b) => (a.meanCostS ?? Infinity) - (b.meanCostS ?? Infinity));
  const progress = obj(r.progress);
  return {
    id: str(r.run_id) ?? "",
    status: str(r.status) ?? "unknown",
    benchmark: str(req.benchmark) ?? "?",
    maxItems: num(req.max_items),
    systems: Array.isArray(req.systems) ? req.systems.filter((s): s is string => typeof s === "string") : Object.keys(systems),
    startedAt: str(r.started_at) ?? str(r.created_at),
    finishedAt: str(r.finished_at),
    progress: { done: num(progress.done) ?? 0, total: num(progress.total) ?? 0 },
    error: str(r.error),
    points,
  };
}

export function toDuoDatasets(list: unknown): DuoDataset[] {
  return (Array.isArray(list) ? list : []).map(obj).flatMap((d) => {
    const name = str(d.name);
    if (!name) return [];
    return [{ name, tasks: num(d.tasks) ?? 0, verifiable: num(d.verifiable) ?? 0, domains: Object.keys(obj(d.domains)) }];
  });
}

export async function listDuoEvals(): Promise<{ datasets: DuoDataset[]; runs: DuoEvalRun[] }> {
  const [datasets, runs] = await Promise.all([duoGateway("/v1/eval/datasets"), duoGateway("/v1/eval/runs")]);
  return {
    datasets: toDuoDatasets(datasets),
    runs: (Array.isArray(runs) ? runs : [])
      .map(toDuoEvalRun)
      .filter((r) => r.id)
      .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? "")),
  };
}

export async function getDuoEval(id: string): Promise<DuoEvalRun> {
  if (!UUID.test(id)) throw new DuoError("Unknown run", 404);
  return toDuoEvalRun(await duoGateway(`/v1/eval/runs/${id}`));
}

export async function startDuoEval(r: DuoEvalRequest): Promise<DuoEvalRun> {
  const body = { benchmark: r.benchmark, systems: r.systems, max_items: r.maxItems, shuffle: true, seed: r.seed ?? 0 };
  return toDuoEvalRun(await duoGateway("/v1/eval/runs", { method: "POST", body }));
}

export async function cancelDuoEval(id: string): Promise<void> {
  if (!UUID.test(id)) throw new DuoError("Unknown run", 404);
  await duoGateway(`/v1/eval/runs/${id}/cancel`, { method: "POST" });
}
