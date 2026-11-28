import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoadRun } from "@/modules/duo/components/speed/load-test";
import { protocolRows } from "@/modules/duo/components/speed/protocol";
import { DuoSpeed } from "@/modules/duo/components/speed/speed-page";

const B1 = "b1000000-0000-4000-8000-000000000001";
const P1 = "p1000000-0000-4000-8000-000000000001";
const SETS = { "chat-short": { label: "Short chat (fast path)", prompts: ["Say hello in one short sentence."] }, math: { label: "Word problems", prompts: ["x"] } };
const STAGES = {
  replies: 40,
  paths: [
    {
      mode: "fast",
      replies: 30,
      wall_p50_ms: 2100,
      wall_p95_ms: 4800,
      overhead_share: 0.1,
      stages: [
        { stage: "draft", n: 30, p50_ms: 1800, p95_ms: 4000, share: 0.8, overlaps_draft: false },
        { stage: "sample", n: 30, p50_ms: 900, p95_ms: 1500, share: null, overlaps_draft: true },
        { stage: "verify", n: 10, p50_ms: 80, p95_ms: 200, share: 0.1, overlaps_draft: false },
      ],
    },
  ],
  engine: [{ stage: "draft", calls: 30, prefill_tok_s: 4500, decode_tok_s: 131.4, cache_reuse: 0.62, queue_p95_ms: 12 }],
};
const q = (p50: number) => ({ n: 12, p50, p95: p50 * 2, p99: p50 * 3, mean: p50 * 1.2 });
const DONE_BENCH = {
  run_id: B1,
  kind: "bench",
  status: "done",
  created_at: "2026-11-27T10:00:00Z",
  elapsed_s: 30,
  request: { prompt_set: "chat-short", mode: "fast", concurrency: 2, requests: 12 },
  results: { requests: 12, ok: 12, error_rate: 0, throughput_rps: 0.4, tokens_per_s: 50, escalation_rate: 0, ttft_ms: q(300), latency_ms: q(2000), latency_fast_ms: q(2000), latency_slow_ms: { n: 0 } },
  samples: [{ t_start_ms: 0, latency_ms: 2000, ok: true, mode: "fast", ttft_ms: 300 }],
};
const PROTO = {
  run_id: P1,
  kind: "protocol",
  status: "done",
  created_at: "2026-11-26T10:00:00Z",
  request: { prompt_set: "chat-short", levels: [1, 2, 4], requests_per_session: 8 },
  table: [
    { concurrency: 1, requests: 8, ok: 8, p50_ms: 2000, p95_ms: 3000, p99_ms: 3100, ttft_p95_ms: 400, throughput_rps: 0.5, escalation_rate: 0, cost_per_request_s: 2 },
    { concurrency: 2, requests: 16, ok: 16, p50_ms: 2400, p95_ms: 4500, p99_ms: 4800, ttft_p95_ms: 600, throughput_rps: 0.8, escalation_rate: 0, cost_per_request_s: 2.4 },
  ],
  nfr007: { pass: true, ratio: 1.5, limit_sessions: 2 },
};

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status }));
type Handler = (init: RequestInit | undefined, url: string) => Promise<Response>;
function routes(map: Record<string, Handler | unknown>) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url.replace(/^\/api\/duo\/gw/, "").split("?")[0]}`;
    const h = map[key];
    if (h === undefined) return json({ message: `no mock for ${key}` }, 404);
    return typeof h === "function" ? (h as Handler)(init, url) : json(h);
  });
}
const calls = (key: string) => fetchMock.mock.calls.filter(([url, init]) => `${init?.method ?? "GET"} ${String(url).replace(/^\/api\/duo\/gw/, "").split("?")[0]}` === key);

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("protocolRows", () => {
  it("builds rows from finished levels while the protocol runs", () => {
    expect(protocolRows({ levels: [{ concurrency: 1, results: { requests: 8, ok: 7, latency_ms: { p50: 1, p95: 2, p99: 3 }, ttft_ms: { p95: 4 } } }] })).toEqual([
      expect.objectContaining({ concurrency: 1, requests: 8, ok: 7, p50_ms: 1, p95_ms: 2, p99_ms: 3, ttft_p95_ms: 4 }),
    ]);
  });
});

describe("DuoSpeed", () => {
  const base = {
    "GET /v1/bench/prompt-sets": SETS,
    "GET /v1/perf/stages": STAGES,
    "GET /v1/bench/runs": [DONE_BENCH, PROTO, { run_id: "e1", kind: "engines", status: "done" }],
    [`GET /v1/bench/runs/${B1}`]: DONE_BENCH,
    [`GET /v1/bench/runs/${P1}`]: PROTO,
  };

  it("shows where the time goes, the latest load test, the protocol and past runs", async () => {
    routes(base);
    render(<DuoSpeed />);
    expect(await screen.findByText("Answers System 1 gave")).toBeInTheDocument();
    expect(screen.getByText("Quick draft 80%")).toBeInTheDocument();
    expect(screen.getByText("131.4")).toBeInTheDocument();
    expect(await screen.findByText("Response times")).toBeInTheDocument();
    expect(screen.getAllByText("4.0 s").length).toBeGreaterThan(0); // p95 of all answers
    expect(await screen.findByText(/Target met\./)).toBeInTheDocument();
    expect(screen.getByText("target met (1.50×)")).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/v1/perf/stages?hours=24&lab=false"))).toBe(true);
    // the engine comparison is not shown in the history
    expect(screen.getAllByRole("row").length).toBeGreaterThan(3);
  });

  it("changes the stage window and includes experiments", async () => {
    routes(base);
    render(<DuoSpeed />);
    const user = userEvent.setup();
    await screen.findByText("Answers System 1 gave");
    await user.click(screen.getByRole("radio", { name: "7 days" }));
    await user.click(screen.getByLabelText("Include experiments"));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/v1/perf/stages?hours=168&lab=true"))).toBe(true));
  });

  it("says when there is nothing to measure or no run yet", async () => {
    routes({ "GET /v1/bench/prompt-sets": SETS, "GET /v1/perf/stages": { replies: 0, paths: [], engine: [] }, "GET /v1/bench/runs": [] });
    render(<DuoSpeed />);
    expect(await screen.findByText("No answers to measure yet")).toBeInTheDocument();
    expect(await screen.findByText("No standard load test yet")).toBeInTheDocument();
    expect(screen.getByText("No runs yet")).toBeInTheDocument();
  });

  it("starts a load test with the chosen settings", async () => {
    const running = { run_id: B1, kind: "bench", status: "running", request: { prompt_set: "math", mode: "auto", concurrency: 4, duration_s: 60 }, elapsed_s: 0, results: { requests: 0 } };
    routes({ ...base, "GET /v1/bench/runs": [], "POST /v1/bench/runs": () => json(running, 202), [`GET /v1/bench/runs/${B1}`]: running });
    render(<DuoSpeed />);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Prompt set"), "math");
    await user.selectOptions(screen.getByLabelText("Answer mode"), "auto");
    await user.selectOptions(screen.getByLabelText("Simultaneous users"), "4");
    await user.selectOptions(screen.getByLabelText("Stop after"), "d:60");
    await user.click(screen.getByRole("button", { name: /^start$/i }));
    await waitFor(() => expect(calls("POST /v1/bench/runs").length).toBe(1));
    expect(JSON.parse(String(calls("POST /v1/bench/runs")[0][1]!.body))).toEqual({ prompt_set: "math", mode: "auto", concurrency: 4, max_tokens: 128, duration_s: 60 });
    expect(await screen.findByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("keeps the gateway's newest-first order, so a running test without dates opens first", async () => {
    const B2 = "b2000000-0000-4000-8000-000000000002";
    const progress = { run_id: B2, kind: "bench", status: "running", request: { prompt_set: "math", mode: "fast", concurrency: 1, requests: 12 }, elapsed_s: 1, results: { requests: 1 } };
    routes({ ...base, "GET /v1/bench/runs": [progress, DONE_BENCH, PROTO], [`GET /v1/bench/runs/${B2}`]: progress });
    render(<DuoSpeed />);
    await waitFor(() => expect(calls(`GET /v1/bench/runs/${B2}`).length).toBeGreaterThan(0));
    expect(calls(`GET /v1/bench/runs/${B1}`)).toHaveLength(0);
  });

  it("lets the answer length be typed freely and clamps it when the field is left", async () => {
    routes({ ...base, "GET /v1/bench/runs": [], "POST /v1/bench/runs": () => json({ run_id: B1, status: "running" }, 202) });
    render(<DuoSpeed />);
    const user = userEvent.setup();
    const field = await screen.findByLabelText("Answer length");
    await user.clear(field);
    await user.type(field, "512");
    expect(field).toHaveValue(512);
    await user.clear(field);
    await user.type(field, "5");
    expect(field).toHaveValue(5);
    await user.tab();
    expect(field).toHaveValue(16);
    await user.clear(field);
    await user.type(field, "9999");
    await user.click(screen.getByRole("button", { name: /^start$/i }));
    await waitFor(() => expect(calls("POST /v1/bench/runs").length).toBe(1));
    expect(JSON.parse(String(calls("POST /v1/bench/runs")[0][1]!.body)).max_tokens).toBe(2048);
  });

  it("asks before the standard load test and starts it", async () => {
    routes({ ...base, "GET /v1/bench/runs": [], "POST /v1/bench/protocol": () => json({ run_id: P1, kind: "protocol", status: "running" }, 202), [`GET /v1/bench/runs/${P1}`]: { ...PROTO, status: "running", table: undefined, levels: [], level_index: 0 } });
    render(<DuoSpeed />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /run the standard load test/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/everyone's answers are slower/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Run the test" }));
    await waitFor(() => expect(calls("POST /v1/bench/protocol").length).toBe(1));
    expect(JSON.parse(String(calls("POST /v1/bench/protocol")[0][1]!.body))).toEqual({ prompt_set: "chat-short", mode: "fast", levels: [1, 2, 4], requests_per_session: 8, max_tokens: 128 });
    expect(await screen.findByText(/Running step 1 of 3/)).toBeInTheDocument();
  });
});

describe("LoadRun", () => {
  it("polls while running, cancels, and stops polling once cancelled", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    let cancelled = false;
    const onEnded = vi.fn();
    routes({
      [`GET /v1/bench/runs/${B1}`]: () => {
        n += 1;
        return json(
          cancelled
            ? { ...DONE_BENCH, status: "cancelled" }
            : { ...DONE_BENCH, status: "running", elapsed_s: n, results: { ...DONE_BENCH.results, requests: n } }
        );
      },
      [`POST /v1/bench/runs/${B1}/cancel`]: () => {
        cancelled = true;
        return json(null, 202);
      },
    });
    render(<LoadRun runId={B1} onEnded={onEnded} />);
    expect(await screen.findByText(/^1 \/ 12 questions/)).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1600));
    expect(await screen.findByText(/^2 \/ 12 questions/)).toBeInTheDocument();
    await act(async () => {
      screen.getByRole("button", { name: /cancel/i }).click();
    });
    await waitFor(() => expect(calls(`POST /v1/bench/runs/${B1}/cancel`).length).toBe(1));
    await act(() => vi.advanceTimersByTimeAsync(1600));
    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
    expect(onEnded).toHaveBeenCalledTimes(1);
    const seen = n;
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(n).toBe(seen);
  });

  it("shows a load test that cannot be loaded", async () => {
    routes({ [`GET /v1/bench/runs/${B1}`]: () => json({ message: "active run not found" }, 404) });
    render(<LoadRun runId={B1} onEnded={() => {}} />);
    expect(await screen.findByText("Could not load this load test")).toBeInTheDocument();
  });
});
