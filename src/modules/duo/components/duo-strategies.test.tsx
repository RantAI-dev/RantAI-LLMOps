import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DuoEvalRun } from "@/lib/duo-evals";
import { DuoStrategies, finding } from "@/modules/duo/components/duo-strategies";

const point = (system: string, label: string, accuracy: number, meanCostS: number, over: object = {}) => ({
  system,
  label,
  accuracy,
  ci: null,
  meanCostS,
  costVsSlow: meanCostS / 32.6,
  pareto: system !== "slow_only",
  n: 60,
  escalationRate: system === "slow_only" ? 1 : system === "fast_only" ? 0 : 0.18,
  meanModelCalls: 1,
  meanReasoningTokens: 0,
  ...over,
});

const DONE: DuoEvalRun = {
  id: "47245e89-0000-4000-8000-000000000001",
  status: "done",
  benchmark: "gsm8k",
  maxItems: 60,
  systems: ["nafs_aql", "fast_only", "slow_only"],
  startedAt: "2026-11-16T04:27:51Z",
  finishedAt: "2026-11-16T05:15:32Z",
  progress: { done: 180, total: 180 },
  error: null,
  points: [
    point("fast_only", "System 1 only", 0.8167, 3.0),
    point("nafs_aql", "Gate (default λ)", 0.9833, 12.0),
    point("slow_only", "System 2 always", 0.9833, 32.6),
  ],
};

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("finding", () => {
  it("states the best gate against System 2 always", () => {
    expect(finding(DONE.points)).toBe(
      "Gate (default λ): 98.3% accuracy against 98.3% for System 2 always, at 37% of its time; System 2 answered 18% of questions."
    );
  });

  it("says nothing without both a gate and System 2 always", () => {
    expect(finding(DONE.points.filter((p) => p.system !== "slow_only"))).toBeNull();
  });
});

describe("DuoStrategies", () => {
  it("shows the latest finished comparison as a chart and a table", async () => {
    fetchMock.mockImplementation(() => json({ configured: true, datasets: [{ name: "gsm8k", tasks: 1319, verifiable: 1319, domains: ["math"] }], runs: [DONE] }));
    render(<DuoStrategies />);
    expect(await screen.findByRole("img", { name: /accuracy against seconds per question/i })).toBeInTheDocument();
    expect(screen.getByText(/at 37% of its time/)).toBeInTheDocument();
    expect(screen.getAllByText("System 2 always").length).toBeGreaterThan(0);
    expect(screen.getByRole("option", { name: /gsm8k \(1319 questions, math\)/ })).toBeInTheDocument();
  });

  it("starts a comparison with the chosen strategies and follows it", async () => {
    const running: DuoEvalRun = { ...DONE, id: "47245e89-0000-4000-8000-000000000009", status: "running", progress: { done: 0, total: 40 }, points: [] };
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return json(running, 202);
      return json({ configured: true, datasets: [], runs: [] });
    });
    render(<DuoStrategies />);
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText("Gate, λ 0.40"));
    await user.click(screen.getByRole("button", { name: /compare/i }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === "POST")).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")!;
    expect(JSON.parse(init.body)).toEqual({ benchmark: "gsm8k", systems: ["fast_only", "slow_only", "nafs_aql", "nafs_aql_l40"], maxItems: 30 });
    expect(await screen.findByText("0/40 answers")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
  });

  it("says when the gateway is not configured", async () => {
    fetchMock.mockImplementation(() => json({ configured: false, datasets: [], runs: [] }));
    render(<DuoStrategies />);
    expect(await screen.findByText(/Duo gateway is not configured/)).toBeInTheDocument();
  });
});
