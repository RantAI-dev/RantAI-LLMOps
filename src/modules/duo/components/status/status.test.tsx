import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ACTIVITY_REFRESH_MS, Activity } from "@/modules/duo/components/status/activity";
import { DuoStatus } from "@/modules/duo/components/status/status-page";

const role = (r: string, over: object = {}) => ({
  role: r,
  url: `http://vllm-${r}:8000`,
  model: r,
  hf_id: r === "system1" ? "Qwen/Qwen3-1.7B" : "Qwen/Qwen3-4B-Thinking-2507",
  ok: true,
  latency_ms: 12,
  in_flight: 1,
  max_in_flight: 4,
  ...over,
});
const VLLM = { name: "vllm", label: "vLLM on the GB10", kind: "vllm", active: true, serves_system1: true, serves_system2: true, system1: role("system1"), system2: role("system2") };
const SYSTEM = {
  version: "0.44.0",
  config_hash: "abc123",
  config_warnings: [],
  profile: "gb10",
  active_backend: "vllm",
  active_engines: { system1: "vllm", system2: "vllm" },
  uptime_s: 7200,
  inflight: 0,
  host: { os: "linux", arch: "aarch64", cpus: 20 },
  security: { auth_enabled: true, loopback_only: false, sandbox_isolation: true, retention_days: 30 },
  backends: [VLLM],
  gate: {
    k_samples: 3,
    lambda_default: 0.2,
    cost_unit_s: 60,
    loss_wrong: 1,
    audit_fraction: 0.05,
    state: {
      mode: "calibrated",
      effective_rule: "calibrated",
      promoted: true,
      calibration: { version: "cal-2026-11-20", fitted_at: "2026-11-20T00:00:00Z", n: 2900, n_pos: 400, n_neg: 2500, ece: 0.031, brier: 0.09 },
      requirements: { min_n: 300, min_per_class: 30, max_ece: 0.05 },
      params: { math: { e2_hat: 0.04, e2_source: "measured", delta_c_s: 28.5, delta_c_source: "measured", caps: { N: 1, R: 2, budget: 1024 }, caps_source: "placeholder" } },
    },
  },
  judge: { enabled: true, max_retries: 1 },
  audit: { counts: {} },
  deliberation: { draft_blind: true, draft_max_tokens: 512, answer_max_tokens: 2048, non_verifiable_max_rounds: 2, max_rounds_cap: 4, caps: {} },
  server: { request_wall_clock_cap_s: 600, max_prompt_tokens: 16000 },
  knowledge: { enabled: true },
};
const ACTIVITY = [
  { created_at: new Date().toISOString(), domain: "math", mode: "slow", assurance: "verified", wall_ms: 32000, ttft_ms: 900, rule: "calibrated", backend: "vllm" },
  { created_at: new Date().toISOString(), domain: "open", mode: "fast", assurance: "unverified", wall_ms: 2100, ttft_ms: 200, rule: "calibrated", backend: "vllm" },
];

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
type Handler = (init: RequestInit | undefined) => Promise<Response>;
function routes(map: Record<string, Handler | unknown>) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${url.replace(/^\/api\/duo\/gw/, "").split("?")[0]}`;
    const h = map[key];
    if (h === undefined) return json({ message: `no mock for ${key}` }, 404);
    return typeof h === "function" ? (h as Handler)(init) : json(h);
  });
}
const calls = (key: string) => fetchMock.mock.calls.filter(([url, init]) => `${init?.method ?? "GET"} ${String(url).replace(/^\/api\/duo\/gw/, "")}` === key);

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("DuoStatus", () => {
  it("shows both models with health, the gate, caps, calibration, host and recent answers", async () => {
    routes({ "GET /v1/system": SYSTEM, "GET /healthz": { status: "ok", backend: "vllm", backends: { system1: "ready", system2: "ready" } }, "GET /v1/system/activity": ACTIVITY });
    render(<DuoStatus />);
    expect(await screen.findByText("Qwen/Qwen3-1.7B")).toBeInTheDocument();
    expect(screen.getByText("Qwen/Qwen3-4B-Thinking-2507")).toBeInTheDocument();
    expect(screen.getAllByText("1 of 4 answer slots busy", { exact: false }).length).toBe(2);
    expect(screen.getByText("cal-2026-11-20")).toBeInTheDocument();
    expect(screen.getByText("Calls System 2 when the predicted gain in accuracy is worth the extra time")).toBeInTheDocument();
    expect(screen.getByText("28.5 s")).toBeInTheDocument();
    expect(screen.getByText("1,024 tokens")).toBeInTheDocument();
    expect(screen.getByText("linux/aarch64 · 20 CPUs")).toBeInTheDocument();
    // only vLLM is configured: nothing to switch to
    expect(screen.getByText(/Only one engine is configured on this gateway \(vLLM\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /switch/i })).not.toBeInTheDocument();
    // recent activity
    expect(await screen.findByText("Recent activity")).toBeInTheDocument();
    expect(screen.getByText("System 2 took over")).toBeInTheDocument();
    expect(screen.getAllByText("Checked").length).toBeGreaterThan(0);
  });

  it("shows a model that is down", async () => {
    routes({
      "GET /v1/system": { ...SYSTEM, backends: [{ ...VLLM, system2: role("system2", { ok: false, error: "connection refused" }) }] },
      "GET /healthz": { status: "degraded", backends: { system1: "ready", system2: "unavailable" } },
      "GET /v1/system/activity": [],
    });
    render(<DuoStatus />);
    expect(await screen.findByText("connection refused")).toBeInTheDocument();
    expect(screen.getByText("Not reachable")).toBeInTheDocument();
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(await screen.findByText("No answers yet")).toBeInTheDocument();
  });

  it("switches engine only after a confirmation", async () => {
    const other = { name: "sglang", label: "SGLang", kind: "sglang", active: false, serves_system1: false, serves_system2: false, system1: role("system1"), system2: role("system2") };
    routes({
      "GET /v1/system": { ...SYSTEM, backends: [VLLM, other] },
      "GET /healthz": { status: "ok", backends: { system1: "ready", system2: "ready" } },
      "GET /v1/system/activity": [],
      "POST /v1/system/backend": { active_backend: "sglang", system1_engine: "sglang", system2_engine: "sglang", previous: "vllm", warmed_prefixes: 3 },
    });
    render(<DuoStatus />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /switch to this/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Answers already in progress finish where they started/)).toBeInTheDocument();
    expect(calls("POST /v1/system/backend").length).toBe(0);
    await user.click(within(dialog).getByRole("button", { name: /^switch$/i }));
    await waitFor(() => expect(calls("POST /v1/system/backend").length).toBe(1));
    expect(JSON.parse(String(calls("POST /v1/system/backend")[0][1]!.body))).toEqual({ name: "sglang" });
  });

  it("moves the engine choices to the new pair after a switch, so Use these does not switch back", async () => {
    const other = { name: "sglang", label: "SGLang", kind: "sglang", active: false, serves_system1: false, serves_system2: false, system1: role("system1"), system2: role("system2") };
    let switched = false;
    routes({
      "GET /v1/system": () =>
        json(
          switched
            ? { ...SYSTEM, active_backend: "sglang", active_engines: { system1: "sglang", system2: "sglang" }, backends: [{ ...VLLM, active: false, serves_system1: false, serves_system2: false }, { ...other, active: true }] }
            : { ...SYSTEM, backends: [VLLM, other] }
        ),
      "GET /healthz": { status: "ok", backends: { system1: "ready", system2: "ready" } },
      "GET /v1/system/activity": [],
      "POST /v1/system/backend": () => {
        switched = true;
        return json({ active_backend: "sglang", system1_engine: "sglang", system2_engine: "sglang", previous: "vllm", warmed_prefixes: 0 });
      },
    });
    render(<DuoStatus />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /switch to this/i }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /^switch$/i }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "System 1" })).toHaveValue("sglang"));
    expect(screen.getByRole("combobox", { name: "System 2" })).toHaveValue("sglang");
    await waitFor(() => expect(screen.getByRole("button", { name: "Use these" })).toBeDisabled());
  });

  it("explains a gateway that is not configured", async () => {
    routes({ "GET /v1/system": () => json({ error: "x" }, 503), "GET /healthz": () => json({ error: "x" }, 503) });
    render(<DuoStatus />);
    expect(await screen.findByText("Semantic Duo is not configured")).toBeInTheDocument();
  });
});

describe("Activity", () => {
  it("refreshes by itself and filters by model", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    routes({ "GET /v1/system/activity": ACTIVITY });
    render(<Activity />);
    expect(await screen.findByText("open")).toBeInTheDocument();
    const before = calls("GET /v1/system/activity").length;
    await act(() => vi.advanceTimersByTimeAsync(ACTIVITY_REFRESH_MS + 100));
    await waitFor(() => expect(calls("GET /v1/system/activity").length).toBeGreaterThan(before));
    vi.useRealTimers();
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "System 2" }));
    expect(screen.queryByText("open")).not.toBeInTheDocument();
    expect(screen.getByText("math")).toBeInTheDocument();
  });
});
