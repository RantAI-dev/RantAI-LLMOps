import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DuoError } from "@/lib/duo";
import { cancelDuoEval, getDuoEval, isStrategy, listDuoEvals, parseDuoEvalRequest, startDuoEval, strategyLabel, toDuoEvalRun } from "@/lib/duo-evals";

// The GB10 run of 16 Nov 2026 (GSM8K, 60 questions), trimmed to the fields the page reads.
const RUN = {
  run_id: "47245e89-0000-4000-8000-000000000001",
  kind: "eval",
  status: "done",
  started_at: "2026-11-16T04:27:51Z",
  finished_at: "2026-11-16T05:15:32Z",
  progress: { done: 180, total: 180 },
  request: { benchmark: "gsm8k", max_items: 60, systems: ["nafs_aql", "fast_only", "slow_only"] },
  systems: {
    fast_only: { accuracy: 0.8167, accuracy_ci95: [0.70, 0.90], escalation_rate: 0, mean_model_calls: 1, mean_wall_ms: 2989, n: 60 },
    nafs_aql: { accuracy: 0.9833, accuracy_ci95: [0.9106, 0.9996], escalation_rate: 0.1833, mean_model_calls: 2.4, mean_wall_ms: 12038, n: 60 },
    slow_only: { accuracy: 0.9833, accuracy_ci95: [0.91, 0.9996], escalation_rate: 1, mean_model_calls: 1, mean_wall_ms: 32618, n: 60 },
  },
  frontier: [
    { system: "fast_only", accuracy: 0.8167, mean_cost_s: 2.989, cost_vs_slow: 0.0916, pareto: true, n: 60 },
    { system: "nafs_aql", accuracy: 0.9833, mean_cost_s: 12.038, cost_vs_slow: 0.3691, pareto: true, n: 60 },
    { system: "slow_only", accuracy: 0.9833, mean_cost_s: 32.618, cost_vs_slow: 1, pareto: false, n: 60 },
  ],
};

describe("parseDuoEvalRequest", () => {
  it("accepts the strategies the gateway knows, defaulting to 30 questions", () => {
    expect(parseDuoEvalRequest({ benchmark: "gsm8k", systems: ["fast_only", "nafs_aql_l40"] })).toEqual({
      benchmark: "gsm8k",
      systems: ["fast_only", "nafs_aql_l40"],
      maxItems: 30,
      seed: undefined,
    });
  });

  it("refuses what the gateway would refuse, with 400", () => {
    const bad: unknown[] = [
      null,
      { systems: ["fast_only"] },
      { benchmark: "../etc", systems: ["fast_only"] },
      { benchmark: "gsm8k", systems: [] },
      { benchmark: "gsm8k", systems: ["rm -rf"] },
      { benchmark: "gsm8k", systems: ["nafs_aql_l101"] },
      { benchmark: "gsm8k", systems: ["fast_only", "fast_only"] },
      { benchmark: "gsm8k", systems: ["fast_only"], maxItems: 0 },
      { benchmark: "gsm8k", systems: ["fast_only"], maxItems: 201 },
      { benchmark: "gsm8k", systems: ["fast_only"], maxItems: 2.5 },
      { benchmark: "gsm8k", systems: ["fast_only"], seed: -1 },
    ];
    for (const b of bad) {
      expect(() => parseDuoEvalRequest(b), JSON.stringify(b)).toThrow(DuoError);
    }
  });

  it("names λ variants in words", () => {
    expect(isStrategy("nafs_aql_l05")).toBe(true);
    expect(strategyLabel("nafs_aql_l05")).toBe("Gate, λ = 0.05");
    expect(strategyLabel("slow_only")).toBe("System 2 always");
  });
});

describe("toDuoEvalRun", () => {
  it("reads the gateway's frontier and intervals, cheapest strategy first", () => {
    const r = toDuoEvalRun(RUN);
    expect(r).toMatchObject({ id: RUN.run_id, status: "done", benchmark: "gsm8k", maxItems: 60, progress: { done: 180, total: 180 } });
    expect(r.points.map((p) => p.system)).toEqual(["fast_only", "nafs_aql", "slow_only"]);
    expect(r.points[1]).toMatchObject({ label: "Gate (default λ)", accuracy: 0.9833, meanCostS: 12.038, costVsSlow: 0.3691, pareto: true, escalationRate: 0.1833 });
    expect(r.points[1].ci).toEqual([0.9106, 0.9996]);
    expect(r.points[2].pareto).toBe(false);
  });

  it("works out the frontier itself when the gateway sent none", () => {
    const r = toDuoEvalRun({ ...RUN, frontier: undefined });
    expect(r.points.map((p) => [p.system, p.pareto])).toEqual([
      ["fast_only", true],
      ["nafs_aql", true],
      ["slow_only", false],
    ]);
    expect(r.points[1].meanCostS).toBeCloseTo(12.038);
    expect(r.points[1].costVsSlow).toBeCloseTo(12038 / 32618);
  });

  it("never throws on a running or broken run", () => {
    expect(toDuoEvalRun({ run_id: "x", status: "running", progress: { done: 3, total: 90 } })).toMatchObject({ status: "running", points: [], progress: { done: 3, total: 90 } });
    expect(toDuoEvalRun(null)).toMatchObject({ id: "", status: "unknown", points: [] });
  });
});

describe("gateway calls", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DUO_GATEWAY_URL", "http://rantai-aql:8080/");
    vi.stubEnv("DUO_GATEWAY_TOKEN", "secret-token");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fetchMock.mockReset();
  });

  it("lists datasets and runs, newest first, with the server-side token", async () => {
    const older = { ...RUN, run_id: "47245e89-0000-4000-8000-000000000002", started_at: "2026-11-10T00:00:00Z" };
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(url.endsWith("/datasets") ? [{ name: "gsm8k", tasks: 1319, verifiable: 1319, domains: { math: 1319 } }] : [older, RUN])
        )
      )
    );
    const out = await listDuoEvals();
    expect(out.datasets).toEqual([{ name: "gsm8k", tasks: 1319, verifiable: 1319, domains: ["math"] }]);
    expect(out.runs.map((r) => r.id)).toEqual([RUN.run_id, older.run_id]);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer secret-token");
  });

  it("starts a shuffled run with the gateway's field names", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ run_id: RUN.run_id, status: "running", request: { benchmark: "gsm8k" } }), { status: 202 }));
    const r = await startDuoEval({ benchmark: "gsm8k", systems: ["fast_only", "nafs_aql"], maxItems: 20 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://rantai-aql:8080/v1/eval/runs");
    expect(JSON.parse(init.body)).toEqual({ benchmark: "gsm8k", systems: ["fast_only", "nafs_aql"], max_items: 20, shuffle: true, seed: 0 });
    expect(r.status).toBe("running");
  });

  it("only asks the gateway about run ids that are UUIDs, and takes an empty 202 on cancel", async () => {
    await expect(getDuoEval("../../v1/fs/read")).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    await expect(cancelDuoEval(RUN.run_id)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0][0]).toBe(`http://rantai-aql:8080/v1/eval/runs/${RUN.run_id}/cancel`);
  });
});
