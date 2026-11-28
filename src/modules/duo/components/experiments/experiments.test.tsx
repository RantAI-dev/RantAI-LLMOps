import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DuoExperiments } from "@/modules/duo/components/experiments/experiments-page";
import { Insights } from "@/modules/duo/components/experiments/insights";
import { composeSystems } from "@/modules/duo/components/experiments/new-experiment";
import { RunDetail, strategyPoints } from "@/modules/duo/components/experiments/run-detail";

const ID = "47245e89-0000-4000-8000-000000000001";
const ID2 = "47245e89-0000-4000-8000-000000000002";
const DATASETS = [
  { name: "gsm8k", tasks: 1319, verifiable: 1319, domains: { math: 1319 } },
  { name: "smoke_mixed", tasks: 12, verifiable: 12, domains: { math: 4, code: 4, format: 4 } },
];
const DONE = {
  run_id: ID,
  kind: "eval",
  status: "done",
  started_at: "2026-11-16T04:27:51Z",
  progress: { done: 6, total: 6 },
  request: { benchmark: "gsm8k", max_items: 2, systems: ["nafs_aql", "fast_only", "slow_only"] },
  systems: {
    fast_only: { n: 2, accuracy: 0.5, accuracy_ci95: [0.1, 0.9], mean_wall_ms: 3000, escalation_rate: 0, assurance: { verified: 2 } },
    nafs_aql: { n: 2, accuracy: 1, accuracy_ci95: [0.34, 1], mean_wall_ms: 12000, escalation_rate: 0.5, assurance: { verified: 2 } },
    slow_only: { n: 2, accuracy: 1, accuracy_ci95: [0.34, 1], mean_wall_ms: 30000, escalation_rate: 1, assurance: { verified: 2 } },
  },
  paired: [{ a: "nafs_aql", b: "slow_only", n_pairs: 2, delta_accuracy: 0, ci95: [-0.2, 0.2], mcnemar_p: 1, p_bonferroni: 1, cost_ratio: 0.4, non_inferior_3pt: false }],
  calibration: { ece_e1: 0.04, brier_e1: 0.1, n: 2, draft_error_rate: 0.5, calibration_in_use: "fixed rule", reliability: [{ predicted: 0.2, observed: 0.5, count: 2 }] },
  items: [
    { task_id: "gsm8k-1", system: "fast_only", correct: false, mode: "fast", assurance: "verified", wall_ms: 3000, answer_preview: "41", evidence: "expected 42" },
    { task_id: "gsm8k-1", system: "slow_only", correct: true, mode: "slow", assurance: "verified", wall_ms: 30000, answer_preview: "42" },
  ],
};
const CANCELLED = { ...DONE, run_id: ID2, status: "cancelled", started_at: "2026-11-15T04:00:00Z", systems: {}, items: [], paired: [], calibration: null, progress: { done: 1, total: 6 } };

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status }));
type Handler = (init: RequestInit | undefined, url: string) => Promise<Response>;
/** Routes the mocked fetch by "METHOD /gateway/path" (query string ignored); unknown routes answer 404. */
function routes(map: Record<string, Handler | unknown>) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const path = url.replace(/^\/api\/duo\/gw/, "").split("?")[0];
    const key = `${init?.method ?? "GET"} ${path}`;
    const h = map[key];
    if (h === undefined) return json({ message: `no mock for ${key}` }, 404);
    return typeof h === "function" ? (h as Handler)(init, url) : json(h);
  });
}
const calls = (key: string) =>
  fetchMock.mock.calls.filter(([url, init]) => `${init?.method ?? "GET"} ${String(url).replace(/^\/api\/duo\/gw/, "").split("?")[0]}` === key);

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("composeSystems", () => {
  it("adds the budget and speed-weight sweeps, without repeats", () => {
    expect(composeSystems(["fast_only", "slow_only"], "256, 512, 9", "0.05,0.2,2")).toEqual(["fast_only", "slow_only", "slow_b256", "slow_b512", "nafs_blind_l05", "nafs_blind_l20"]);
    expect(composeSystems(["fast_only"], null, null)).toEqual(["fast_only"]);
  });
});

describe("strategyPoints", () => {
  it("marks the frontier when the gateway sent none", () => {
    const p = strategyPoints(DONE);
    expect(p.map((x) => [x.system, x.pareto])).toEqual([
      ["fast_only", true],
      ["nafs_aql", true],
      ["slow_only", false],
    ]);
    expect(p[1].costVsSlow).toBeCloseTo(0.4);
  });
});

describe("DuoExperiments", () => {
  it("shows the newest experiment with its results, and the run list", async () => {
    routes({ "GET /v1/eval/datasets": DATASETS, "GET /v1/eval/runs": [CANCELLED, DONE], [`GET /v1/eval/runs/${ID}`]: DONE });
    render(<DuoExperiments />);
    expect(await screen.findByRole("img", { name: /accuracy against seconds per question/i })).toBeInTheDocument();
    expect(screen.getByText(/at 40% of its time/)).toBeInTheDocument();
    expect(screen.getByText("Head to head")).toBeInTheDocument();
    expect(screen.getByText("How well the gate predicts mistakes")).toBeInTheDocument();
    // the cancelled run can be resumed from the list
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
    // the default question set is the small mixed one
    expect(screen.getByLabelText("Question set")).toHaveValue("smoke_mixed");
  });

  it("says so when there are no experiments yet", async () => {
    routes({ "GET /v1/eval/datasets": DATASETS, "GET /v1/eval/runs": [] });
    render(<DuoExperiments />);
    expect(await screen.findByText("No experiments yet")).toBeInTheDocument();
  });

  it("starts an experiment with a preset and the chosen strategies", async () => {
    const running = { run_id: ID, kind: "eval", status: "running", request: { benchmark: "gsm8k", systems: ["fast_only"] }, progress: { done: 0, total: 0 } };
    routes({
      "GET /v1/eval/datasets": DATASETS,
      "GET /v1/eval/runs": [],
      "POST /v1/eval/runs": () => json(running, 202),
      [`GET /v1/eval/runs/${ID}`]: running,
    });
    render(<DuoExperiments />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /speed against care/i }));
    await user.click(screen.getByRole("button", { name: /^start$/i }));
    await waitFor(() => expect(calls("POST /v1/eval/runs").length).toBe(1));
    const body = JSON.parse(String(calls("POST /v1/eval/runs")[0][1]!.body));
    expect(body).toEqual({
      benchmark: "gsm8k",
      max_items: 15,
      offset: 0,
      systems: ["fast_only", "slow_only", "nafs_blind_l05", "nafs_blind_l20", "nafs_blind_l60"],
      lambda: 0.2,
      shuffle: true,
    });
    expect(await screen.findByRole("button", { name: /^stop$/i })).toBeInTheDocument();
    expect(screen.getByText("0 / ? answers · updates every few seconds")).toBeInTheDocument();
  });

  it("shows the gateway's refusal when a start fails", async () => {
    routes({
      "GET /v1/eval/datasets": DATASETS,
      "GET /v1/eval/runs": [],
      "POST /v1/eval/runs": () => json({ message: "systems must list 1..12 systems" }, 400),
    });
    render(<DuoExperiments />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^start$/i }));
    expect(await screen.findByText("systems must list 1..12 systems")).toBeInTheDocument();
  });

  it("previews a question set and uses it", async () => {
    routes({
      "GET /v1/eval/datasets": DATASETS,
      "GET /v1/eval/runs": [],
      "GET /v1/eval/datasets/gsm8k": [{ id: "gsm8k-7", domain: "math", prompt: "Janet has 3 ducks.", verification: { reference_answer: "18" } }],
    });
    render(<DuoExperiments />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Question sets" }));
    await user.click(screen.getByRole("button", { name: "Preview gsm8k" }));
    expect(await screen.findByText("Janet has 3 ducks.")).toBeInTheDocument();
    expect(screen.getByText(/Checked by: expected answer/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/v1/eval/datasets/gsm8k?limit=8"))).toBe(true);
    await user.click(screen.getByRole("button", { name: "Use this set" }));
    await waitFor(() => expect(screen.getByLabelText("Question set")).toHaveValue("gsm8k"));
  });

  it("follows the selected run after Resume in the list, and sends a single resume", async () => {
    let resumed = false;
    routes({
      "GET /v1/eval/datasets": DATASETS,
      // the list stays stale on purpose: the Resume button must not be usable again
      "GET /v1/eval/runs": [CANCELLED],
      [`GET /v1/eval/runs/${ID2}`]: () => json(resumed ? { ...CANCELLED, status: "running" } : CANCELLED),
      [`POST /v1/eval/runs/${ID2}/resume`]: () => {
        resumed = true;
        return json({ run_id: ID2, status: "running", kept_items: 1 });
      },
    });
    render(<DuoExperiments />);
    const user = userEvent.setup();
    expect(await screen.findByText(/was cancelled/)).toBeInTheDocument();
    const row = within(screen.getByRole("table"));
    await user.click(row.getByRole("button", { name: /resume/i }));
    expect(await screen.findByText(/updates every few seconds/)).toBeInTheDocument();
    expect(screen.queryByText(/was cancelled/)).not.toBeInTheDocument();
    expect(row.getByRole("button", { name: /resume/i })).toBeDisabled();
    await user.click(row.getByRole("button", { name: /resume/i }));
    expect(calls(`POST /v1/eval/runs/${ID2}/resume`).length).toBe(1);
  });

  it("shows the configuration error when the gateway is not set up", async () => {
    routes({ "GET /v1/eval/datasets": () => json({ error: "x" }, 503), "GET /v1/eval/runs": () => json({ error: "x" }, 503) });
    render(<DuoExperiments />);
    expect(await screen.findByText("Semantic Duo is not configured")).toBeInTheDocument();
  });
});

describe("RunDetail", () => {
  it("polls a running experiment and stops once it ends", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    const onChanged = vi.fn();
    routes({
      [`GET /v1/eval/runs/${ID}`]: () => {
        n += 1;
        return json(n < 3 ? { ...DONE, status: "running", progress: { done: n, total: 6 }, items: [] } : DONE);
      },
    });
    render(<RunDetail runId={ID} onChanged={onChanged} />);
    expect(await screen.findByText("1 / 6 answers · updates every few seconds")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(3100));
    expect(await screen.findByText(/2 \/ 6 answers/)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(3100));
    expect(await screen.findByText("6 / 6 answers")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    const seen = n;
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(n).toBe(seen);
  });

  it("explains a failed run and offers no stop", async () => {
    routes({ [`GET /v1/eval/runs/${ID}`]: { ...DONE, status: "failed", error: "dataset: bad line 3", systems: {}, items: [] } });
    render(<RunDetail runId={ID} onChanged={() => {}} />);
    expect(await screen.findByText("The experiment failed: dataset: bad line 3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^stop$/i })).not.toBeInTheDocument();
  });

  it("resumes a cancelled run", async () => {
    routes({ [`GET /v1/eval/runs/${ID2}`]: CANCELLED, [`POST /v1/eval/runs/${ID2}/resume`]: { run_id: ID2, status: "running", kept_items: 1 } });
    render(<RunDetail runId={ID2} onChanged={() => {}} />);
    const user = userEvent.setup();
    expect(await screen.findByText(/was cancelled/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /resume/i }));
    await waitFor(() => expect(calls(`POST /v1/eval/runs/${ID2}/resume`).length).toBe(1));
  });

  it("calibrates from the run and explains that it was not promoted", async () => {
    routes({
      [`GET /v1/eval/runs/${ID}`]: DONE,
      [`POST /v1/eval/runs/${ID}/calibrate`]: {
        promoted: false,
        active: false,
        reason: "needs at least 300 checked answers",
        calibration: { version: "cal-7", n: 2, n_pos: 1, n_neg: 1, ece: 0.2, brier: 0.25, feature_names: ["e1"], weights: [0.5] },
        requirements: { min_n: 300, min_per_class: 30, max_ece: 0.05 },
      },
    });
    render(<RunDetail runId={ID} onChanged={() => {}} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /calibrate from this run/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/what promotion means/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Fit now" }));
    expect(await screen.findByText("New prediction not used")).toBeInTheDocument();
    expect(screen.getByText(/needs at least 300 checked answers/)).toBeInTheDocument();
    expect(JSON.parse(String(calls(`POST /v1/eval/runs/${ID}/calibrate`)[0][1]!.body))).toEqual({ include_ledger: false });
  });

  it("exports the report as a file", async () => {
    const created = vi.fn(() => "blob:x");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    routes({
      [`GET /v1/eval/runs/${ID}`]: DONE,
      [`GET /v1/eval/runs/${ID}/export`]: () =>
        Promise.resolve(new Response("# Report", { status: 200, headers: { "content-disposition": 'attachment; filename="nafs-eval-47245e89.csv"' } })),
    });
    render(<RunDetail runId={ID} onChanged={() => {}} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /spreadsheet/i }));
    await waitFor(() => expect(created).toHaveBeenCalled());
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith(`/v1/eval/runs/${ID}/export?format=csv`))).toBe(true);
  });

  it("filters the answers and opens one", async () => {
    routes({ [`GET /v1/eval/runs/${ID}`]: DONE });
    render(<RunDetail runId={ID} onChanged={() => {}} />);
    const user = userEvent.setup();
    await screen.findByText("Answers");
    await user.click(screen.getByRole("radio", { name: "Wrong" }));
    const rows = screen.getAllByRole("button", { name: "gsm8k-1" });
    expect(rows).toHaveLength(1);
    await user.click(rows[0]);
    expect(await screen.findByText("expected 42")).toBeInTheDocument();
  });
});

describe("Insights", () => {
  it("draws the policy map per topic", async () => {
    routes({
      "GET /v1/lab/insights": {
        runs: 3,
        lambda_grid: [0.05, 0.6],
        domains: [
          {
            domain: "math",
            policies: [{ policy: "fast", accuracy: 0.8, mean_cost_s: 3, n: 60 }],
            policy_map: [
              { lambda: 0.05, policy: "slow", n: 60, confidence: "moderate" },
              { lambda: 0.6, policy: "fast", n: 12, confidence: "low" },
            ],
            value_of_deliberation: { delta_accuracy: 0.17, ci95: [0.05, 0.3], extra_cost_s: 29, pairs: 60 },
            human_preference: { slow: 3, fast: 1 },
          },
        ],
      },
    });
    render(<Insights />);
    expect(await screen.findByText("System 2 always")).toBeInTheDocument();
    expect(screen.getByText("+17 pts")).toBeInTheDocument();
    expect(screen.getByText("75% of 4")).toBeInTheDocument();
    expect(screen.getByLabelText("low confidence")).toBeInTheDocument();
  });

  it("has an empty state", async () => {
    routes({ "GET /v1/lab/insights": { runs: 0, lambda_grid: [], domains: [] } });
    render(<Insights />);
    expect(await screen.findByText("No experiments to pool yet")).toBeInTheDocument();
  });
});
