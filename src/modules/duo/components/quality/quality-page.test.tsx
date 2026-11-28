import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QualityPage, qualitySummary } from "@/modules/duo/components/quality/quality-page";
import { plain } from "@/modules/duo/components/quality/shared";

type Handler = (init?: RequestInit) => unknown;

const GATE = {
  mode: "fixed",
  escalation_budget: 0.3,
  effective_rule: "fixed",
  promoted: false,
  promotion_reason: "needs >= 2900 labelled samples (has 12) (NFR-020)",
  calibration: { version: "prior-v0", n: 0, ece: 0, reliability: [] },
  requirements: { min_n: 2900, min_per_class: 100, max_ece: 0.05, dkw_n: 3000, epsilon: 0.025, delta: 0.05 },
  params: {
    math: { e2_hat: 0.1, e2_source: "placeholder", delta_c_s: 20, delta_c_source: "measured", caps: { N: 1, R: 2, budget: 1024 }, caps_source: "placeholder", budget_source: "placeholder" },
  },
  derived: { derived_at: "2026-11-20T10:00:00Z", source_runs: ["a"] },
  recalibrate_every_h: 24,
};
const SELF = { domains: [{ domain: "math", n: 10, escalation_rate: 0.3, status: "unmeasured", p2_hat: null, n_audit: 2 }], audits: {} };
const ALERTS = { window_min: 60, drill: false, rules: [{ rule: "error_rate", description: "share of failed requests", value: 0.5, threshold: "> 5%", n: 10, state: "firing" }] };
const RATES = { rates: { code_tests: { r: 0.98, phi: 0.004, phi_upper95: 0.012, n_mutants: 400, n_correct: 200 }, judge: { r: 0.9, phi: 0.2, phi_upper95: 0.3 } } };
const LABELS = { enabled: true, ledger: { labelled: 290, draft_wrong: 30 } };

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status }));

/** Route the mocked gateway by "METHOD path" (query string dropped); anything not listed is an empty 200. */
function routes(over: Record<string, Handler | unknown> = {}) {
  const table: Record<string, Handler | unknown> = {
    "GET /v1/gate": GATE,
    "GET /v1/self-model": SELF,
    "GET /v1/alerts": ALERTS,
    "GET /v1/verifiers": RATES,
    "GET /v1/gate/labels": LABELS,
    "GET /v1/verifiers/runs": [],
    "GET /v1/audits": { audits: [], counts: {}, worker: { audit_fraction: 0.05, enabled: true, idle_only: true } },
    "GET /v1/drift": { params: { h: 5 }, domains: [] },
    "GET /v1/preferences": { domains: [] },
    "GET /v1/gates": { gates: [] },
    ...over,
  };
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const path = url.replace("/api/duo/gw", "").split("?")[0];
    const key = `${init?.method ?? "GET"} ${path}`;
    const h = table[key];
    if (h instanceof Response) return Promise.resolve(h);
    if (typeof h === "function") {
      const out = (h as Handler)(init);
      return out instanceof Promise ? out : json(out);
    }
    return json(h ?? {});
  });
}
const calls = (method: string, path: string) =>
  fetchMock.mock.calls.filter(([u, i]) => (i?.method ?? "GET") === method && String(u).replace("/api/duo/gw", "").split("?")[0] === path);

function setup() {
  const user = userEvent.setup();
  render(
    <>
      <QualityPage />
      <Toaster />
    </>
  );
  return user;
}

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("qualitySummary", () => {
  it("weights escalation by answers, ignores the review for the worst check, and is null without data", () => {
    const s = qualitySummary(
      { domains: [{ n: 30, escalation_rate: 0.5, status: "measured" }, { n: 10, escalation_rate: 0.1 }] },
      RATES,
      ALERTS
    );
    expect(s.total).toBe(40);
    expect(s.escalated).toBeCloseTo(0.4);
    expect(s.worst).toBeCloseTo(0.012);
    expect(s.firing).toBe(1);
    expect(s.measured).toBe(1);
    expect(qualitySummary(null, null, null)).toEqual({ total: null, escalated: null, measured: 0, worst: null, firing: null });
  });

  it("puts requirement ids and jargon into plain words", () => {
    expect(plain("System 1 drafts checked by exact verifiers (FR-015)")).toBe("quick drafts checked by exact checks");
  });
});

describe("QualityPage", () => {
  it("shows the summary first and the gate overview", async () => {
    routes();
    setup();
    expect(await screen.findByText("Simple rule", { selector: "button" })).toBeInTheDocument();
    expect(screen.getByText("Answers so far").nextSibling).toHaveTextContent("10");
    expect(screen.getByText("≤ 1.2%")).toBeInTheDocument();
    expect(screen.getByText("in use: Simple rule")).toBeInTheDocument();
    expect(screen.getByText(/needs >= 2900 labelled samples \(has 12\)$/)).toBeInTheDocument(); // the requirement id is dropped
    expect(screen.getAllByText(/290 checked quick answers/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Not learned yet/)).toBeInTheDocument();
  });

  it("asks before switching the rule, and Cancel changes nothing", async () => {
    routes({ "POST /v1/gate": (init?: RequestInit) => ({ ...GATE, mode: JSON.parse(String(init?.body)).mode }) });
    const user = setup();
    await user.click(await screen.findByRole("radio", { name: "Learned" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/for everyone using this service/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(calls("POST", "/v1/gate")).toHaveLength(0);

    await user.click(screen.getByRole("radio", { name: "Learned" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Switch" }));
    await waitFor(() => expect(calls("POST", "/v1/gate")).toHaveLength(1));
    expect(JSON.parse(String(calls("POST", "/v1/gate")[0][1].body))).toEqual({ mode: "calibrated" });
    expect(await screen.findByText(/is selected, but the simple rule stays in use/)).toBeInTheDocument();
  });

  it("goes back to the default settings only after confirmation", async () => {
    routes({ "DELETE /v1/gate/params": { derived: {}, provenance: {} } });
    const user = setup();
    await user.click(await screen.findByRole("button", { name: "Back to defaults" }));
    expect(calls("DELETE", "/v1/gate/params")).toHaveLength(0);
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Use defaults" }));
    await waitFor(() => expect(calls("DELETE", "/v1/gate/params")).toHaveLength(1));
    expect(await screen.findByText("Default settings are in use again")).toBeInTheDocument();
  });

  it("shows the recalibration verdict", async () => {
    routes({
      "POST /v1/gate/recalibrate": {
        promoted: false,
        active: false,
        reason: "ECE 0.09 > 0.05",
        note: "Not promoted; the previous calibration (or the fixed rule) stays in force.",
        calibration: { version: "fit-1", n: 40, n_pos: 10, n_neg: 30, ece: 0.09, brier: 0.2, feature_names: ["bias"], weights: [0.1] },
        requirements: { min_n: 2900, min_per_class: 100, max_ece: 0.05 },
      },
    });
    const user = setup();
    await user.click(await screen.findByRole("button", { name: /Relearn now/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Relearn" }));
    expect(await screen.findByText("New prediction not used")).toBeInTheDocument();
    expect(screen.getByText("ECE 0.09 > 0.05")).toBeInTheDocument();
  });

  it("says what is wrong when the gate cannot be loaded", async () => {
    routes({ "GET /v1/gate": new Response(JSON.stringify({ error: "boom" }), { status: 500 }) });
    setup();
    expect(await screen.findByText("Could not load how Auto decides")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("says Semantic Duo is not configured when the proxy answers 503", async () => {
    fetchMock.mockImplementation(() => json({ error: "Semantic Duo is not configured" }, 503));
    setup();
    expect((await screen.findAllByText("Semantic Duo is not configured")).length).toBeGreaterThan(0);
  });

  it("tunes the settings from experiments: preview first, then apply", async () => {
    routes({
      "GET /v1/eval/runs": [
        { run_id: "e1", status: "done", created_at: new Date().toISOString(), request: { benchmark: "gsm8k", systems: ["fast_only", "slow_only"] } },
        { run_id: "e2", status: "running", request: { benchmark: "mbpp" } },
      ],
      "POST /v1/gate/derive": (init?: RequestInit) => ({
        applied: JSON.parse(String(init?.body)).apply,
        params: { details: { math: { n_slow: 30, n_fast: 30, e2_hat: { value: 0.12, wrong: 3, n: 30 } } }, budgets: { math: 512 } },
      }),
    });
    const user = setup();
    await user.click(await screen.findByRole("button", { name: /Tune from experiments/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("mbpp")).not.toBeInTheDocument(); // a running experiment cannot be used yet
    expect(within(dialog).getByRole("button", { name: "Preview" })).toBeDisabled();
    await user.click(await within(dialog).findByRole("checkbox"));
    await user.click(within(dialog).getByRole("button", { name: "Preview" }));
    expect(await within(dialog).findByText("12.0%")).toBeInTheDocument();
    expect(JSON.parse(String(calls("POST", "/v1/gate/derive")[0][1].body))).toEqual({ run_ids: ["e1"], apply: false, min_n: 10 });
    await user.click(within(dialog).getByRole("button", { name: "Apply these values" }));
    await waitFor(() => expect(calls("POST", "/v1/gate/derive")).toHaveLength(2));
    expect(JSON.parse(String(calls("POST", "/v1/gate/derive")[1][1].body)).apply).toBe(true);
    expect(await screen.findByText("Tuned settings applied")).toBeInTheDocument();
  });

  it("checks: rates table, invalid JSON caught before sending, and the verify call", async () => {
    routes({ "POST /v1/verify": { passed: true, duration_ms: 12, evidence: "2 tests passed" } });
    const user = setup();
    await user.click(await screen.findByRole("tab", { name: "Checks" }));
    expect(await screen.findByText("Code tests")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Review" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "JSON format" }));
    const input = screen.getByLabelText("JSON format");
    await user.clear(input);
    await user.type(input, "{{not json");
    await user.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("The format is not valid JSON.")).toBeInTheDocument();
    expect(calls("POST", "/v1/verify")).toHaveLength(0);

    await user.click(screen.getByRole("radio", { name: "Python tests" }));
    await user.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText(/Passed · 12 ms/)).toBeInTheDocument();
    expect(screen.getByText("2 tests passed")).toBeInTheDocument();
    expect(JSON.parse(String(calls("POST", "/v1/verify")[0][1].body)).verification).toEqual({ tests: ["assert add(2, 3) == 5", "assert add(-1, 1) == 0"] });
  });

  it("checks: a measurement starts after confirmation and shows progress with a stop", async () => {
    let runs: unknown[] = [];
    routes({
      "GET /v1/verifiers/runs": () => runs,
      "POST /v1/verifiers/runs": () => {
        runs = [{ run_id: "r1", status: "running", stage: "exact verifiers", progress: { done: 3, total: 10 }, request: {} }];
        return { run_id: "r1", status: "running" };
      },
    });
    const user = setup();
    await user.click(await screen.findByRole("tab", { name: "Checks" }));
    await user.click(await screen.findByRole("button", { name: "Measure" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Measure" }));
    await waitFor(() => expect(calls("POST", "/v1/verifiers/runs")).toHaveLength(1));
    expect(JSON.parse(String(calls("POST", "/v1/verifiers/runs")[0][1].body))).toMatchObject({ judge_only: false, code_datasets: ["mbpp", "humaneval"] });
    expect(await screen.findByText(/Measuring the exact checks: 3 of 10/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("warnings: the firing rule in plain words, and a drill only after confirmation", async () => {
    routes({ "POST /v1/alerts/drill": { drill_seconds: 120, alerts: { ...ALERTS, drill: true, firing: 1 } } });
    const user = setup();
    await user.click(await screen.findByRole("tab", { name: /Warnings/ }));
    expect(await screen.findByText("Share of failed answers")).toBeInTheDocument();
    expect(screen.getByText("50.0%")).toBeInTheDocument();
    expect(await screen.findByText(/No checked answers yet/)).toBeInTheDocument(); // drift is empty on a fresh install
    await user.click(screen.getByRole("button", { name: /Test warnings/ }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Start the test" }));
    await waitFor(() => expect(calls("POST", "/v1/alerts/drill")).toHaveLength(1));
    expect(JSON.parse(String(calls("POST", "/v1/alerts/drill")[0][1].body))).toEqual({ seconds: 120 });
    expect(await screen.findByText(/every warning shows as on/)).toBeInTheDocument();
  });

  it("spot checks: empty on a fresh install, and run the next one", async () => {
    routes({ "POST /v1/audits/run-next": { completed: false, counts: {} } });
    const user = setup();
    await user.click(await screen.findByRole("tab", { name: "Spot checks" }));
    expect(await screen.findByText(/No spot checks yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run the next spot check" }));
    expect(await screen.findByText("No spot check waiting")).toBeInTheDocument();
  });

  it("spot checks: a row opens the answers and the decision record", async () => {
    routes({
      "GET /v1/audits": {
        counts: { done: 1 },
        worker: { audit_fraction: 0.05 },
        audits: [{ audit_id: "a1", decision_id: "d1", created_at: new Date().toISOString(), status: "done", domain: "math", e1_hat: 0.2, kept_correct: false, slow_correct: true, agreement: 0.4, wall_ms: 9000, kept_preview: "41", slow_preview: "42" }],
      },
      "GET /v1/decisions/d1": { escalate: false, e1_hat: 0.2, e2_hat: 0.05, lambda: 0.2, delta_c: 20, rule: "fixed", explanation: "Kept the System 1 draft", features: { domain: "math" } },
    });
    const user = setup();
    await user.click(await screen.findByRole("tab", { name: "Spot checks" }));
    await user.click(await screen.findByRole("button", { name: "Show details" }));
    expect(screen.getByText("42")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /How Auto decided/ }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("quick answer kept")).toBeInTheDocument();
    expect(within(dialog).getByText("20.0%")).toBeInTheDocument();
  });

  it("release readiness: each milestone opens to its criteria", async () => {
    routes({
      "GET /v1/gates": {
        gates: [
          { gate: "G0", title: "Setup", status: "pending", criteria: [{ id: "H7", criterion: "Decode speed measured", status: "pending", evidence: "no stored measurement" }] },
          { gate: "G1", title: "MVP", status: "pass", criteria: [] },
        ],
      },
    });
    const user = setup();
    await user.click(await screen.findByRole("tab", { name: "Release readiness" }));
    expect(await screen.findByText("Setup measured and model server chosen")).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 met/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Setup measured/ }));
    expect(screen.getByText("Decode speed measured")).toBeInTheDocument();
    expect(screen.getByText("no stored measurement")).toBeInTheDocument();
  });
});
