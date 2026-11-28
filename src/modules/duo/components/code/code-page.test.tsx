import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toast } = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("sonner", () => ({ toast }));

import { checkForm, sandboxProblem, toRun } from "@/modules/duo/components/code/code-lib";
import { CodePage } from "@/modules/duo/components/code/code-page";
import { MAX_FAILURES, POLL_MS, RETRY_MS } from "@/modules/duo/components/code/use-run";

type Reply = unknown | [number, unknown];
const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status }));
const calls = () => fetchMock.mock.calls.map(([u, i]) => `${(i as RequestInit | undefined)?.method ?? "GET"} ${String(u).replace("/api/duo/gw", "")}`);

function serve(routes: Record<string, (init?: RequestInit) => Reply>) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).replace("/api/duo/gw", "").replace(/\?.*$/, "")}`;
    const h = routes[key];
    if (!h) return json({ error: `no mock for ${key}` }, 404);
    const out = h(init);
    return Array.isArray(out) && typeof out[0] === "number" ? json(out[1], out[0]) : json(out);
  });
}

const HARNESS = { code_agent: { enabled: true, model: "system2", max_steps: 6 } };
const SYSTEM_OK = { security: { sandbox_isolation: true } };
const RID = "11111111-2222-3333-4444-555555555555";
const step = (n: number, over: Record<string, unknown> = {}) => ({ step: n, action: "write", observation: `Exit code: 1\nOutput:\nAssertionError ${n}`, passed: false, score: 0.5, ms: 2100, model: "system2", samples: 1, ...over });
const running = (steps: unknown[]) => ({ id: RID, status: "running", task: "Write a function median(xs) that returns the median.", max_steps: 6, steps, request: { task: "Write a function median(xs) that returns the median.", files: {}, verification: { tests: ["assert median([1, 3, 2]) == 2"] } } });
const verified = () => ({
  ...running([step(1), step(2, { action: "patch", passed: true, score: 1 })]),
  status: "verified",
  result: { status: "verified", passed: true, score: 1, files: { "solution.py": "def median(xs):\n    return sorted(xs)[len(xs) // 2]\n" }, wall_ms: 8400, model_calls: 2, verifier_calls: 2, prefill_tokens: 900, cached_tokens: 300, decoded_tokens: 210, diff: "+def median(xs):" },
});

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  vi.clearAllMocks();
});

describe("code-lib", () => {
  it("checks the task and that every test line is an assert", () => {
    expect(checkForm("short", "").errors).toEqual({ task: "Describe the task in a sentence or two.", tests: "Give at least one test, so the result can be checked." });
    expect(checkForm("Write a function f(x) that doubles x.", "assert f(2) == 4\nprint(f(3))").errors.tests).toBe("Line 2 is not an assert. Write each test like: assert f(2) == 4");
    expect(checkForm("Write a function f(x) that doubles x.", "assert f(2) == 4\n\n  assert f(0) == 0  ").tests).toEqual(["assert f(2) == 4", "  assert f(0) == 0"]);
  });

  it("finds the sandbox refusal in a run", () => {
    const run = toRun({ id: "x", status: "failed", task: "t", steps: [], error: "sandbox isolation is not available on this host; refusing to run untrusted code (fail closed)" });
    expect(sandboxProblem(run)).toMatch(/sandbox isolation is not available/);
    expect(sandboxProblem(toRun({ id: "x", status: "exhausted", task: "t", steps: [step(1)] }))).toBeNull();
  });
});

describe("CodePage", () => {
  it("does not start until the form is right", async () => {
    serve({ "GET /v1/harness": () => HARNESS, "GET /v1/system": () => SYSTEM_OK, "GET /v1/harness/runs": () => ({ runs: [], running: false }) });
    const user = userEvent.setup();
    render(<CodePage />);
    expect(await screen.findByText(/No runs yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Write and check" }));
    expect(screen.getByText("Describe the task in a sentence or two.")).toBeInTheDocument();
    expect(screen.getByLabelText("The task")).toHaveFocus();
    await user.type(screen.getByLabelText("The task"), "Write a function f(x) that doubles x.");
    await user.type(screen.getByLabelText("Tests it must pass"), "assert f(2) == 4{Enter}f(3)");
    await user.click(screen.getByRole("button", { name: "Write and check" }));
    expect(screen.getByText(/Line 2 is not an assert/)).toBeInTheDocument();
    expect(calls().some((c) => c.startsWith("POST"))).toBe(false);
  });

  it("starts a run, watches its steps, stops it, and shows the verified program", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let posted: Record<string, unknown> | null = null;
    let state: unknown = running([]);
    serve({
      "GET /v1/harness": () => HARNESS,
      "GET /v1/system": () => SYSTEM_OK,
      "GET /v1/harness/runs": () => ({ runs: [], running: false }),
      "POST /v1/harness/runs": (init) => {
        posted = JSON.parse(String(init?.body));
        return [202, { run_id: RID }];
      },
      [`GET /v1/harness/runs/${RID}`]: () => state,
      [`POST /v1/harness/runs/${RID}/stop`]: () => ({ stopping: true }),
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CodePage />);
    await screen.findByText(/No runs yet/);
    await user.type(screen.getByLabelText("The task"), "Write a function median(xs) that returns the median.");
    await user.type(screen.getByLabelText("Tests it must pass"), "assert median([[1, 3, 2]) == 2");
    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.type(screen.getByLabelText("Starting code (optional)"), "def median(xs):{Enter}    pass");
    await user.selectOptions(screen.getByLabelText("Who writes it"), "system1");
    await user.selectOptions(screen.getByLabelText("Most attempts"), "6");
    await user.click(screen.getByRole("button", { name: "Write and check" }));

    expect(await screen.findByText("Waiting for the first step…")).toBeInTheDocument();
    expect(posted).toEqual({
      task: "Write a function median(xs) that returns the median.",
      verification: { tests: ["assert median([1, 3, 2]) == 2"] },
      files: { "solution.py": "def median(xs):\n    pass\n" },
      model: "system1",
      max_steps: 6,
    });
    expect(screen.getByRole("button", { name: "Write and check" })).toBeDisabled();

    state = running([step(1)]);
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS + 10));
    expect(await screen.findByText("Working: step 2 of at most 6")).toBeInTheDocument();
    expect(screen.getByText("tests fail: 50% pass")).toBeInTheDocument();
    expect(screen.getByText(/AssertionError 1/)).toBeVisible(); // the newest step is open
    expect(screen.getByText("Step 2 of at most 6…")).toHaveAttribute("aria-live", "polite");

    await user.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(calls()).toContain(`POST /v1/harness/runs/${RID}/stop`));
    expect(screen.getByRole("button", { name: /Stopping after this step/ })).toBeDisabled();

    state = verified();
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS + 10));
    expect(await screen.findByRole("heading", { name: "The program" })).toBeInTheDocument();
    expect(screen.getAllByText("All the tests pass").length).toBeGreaterThan(0);
    expect(screen.getByText(/return sorted\(xs\)/)).toBeInTheDocument();
    expect(screen.getByText(/2 model calls, 2 test runs/)).toBeInTheDocument();

    // Polling has stopped now that the run is over.
    const n = calls().filter((c) => c === `GET /v1/harness/runs/${RID}`).length;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 4));
    expect(calls().filter((c) => c === `GET /v1/harness/runs/${RID}`).length).toBe(n);
  });

  it("warns when the sandbox is refused by the host, and shows the gateway's words on a run", async () => {
    const failed = { ...running([]), status: "failed", error: "sandbox isolation is not available on this host; refusing to run untrusted code (fail closed)" };
    serve({
      "GET /v1/harness": () => HARNESS,
      "GET /v1/system": () => ({ security: { sandbox_isolation: false } }),
      "GET /v1/harness/runs": () => ({ runs: [{ id: RID, status: "failed", task: failed.task, created_at: new Date().toISOString(), steps: 0 }], running: false }),
      [`GET /v1/harness/runs/${RID}`]: () => failed,
    });
    const user = userEvent.setup();
    render(<CodePage />);
    expect(await screen.findByText(/The code sandbox is not available on this server, so programs cannot be run/)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /The run failed.*median/ }));
    expect(await screen.findByText("The code sandbox is not available on this server")).toBeInTheDocument();
    expect(screen.getByText(/refusing to run untrusted code/)).toBeInTheDocument();
  });

  it("says why a run could not start, and points to the run already going on 409", async () => {
    let status = 400;
    serve({
      "GET /v1/harness": () => HARNESS,
      "GET /v1/system": () => SYSTEM_OK,
      "GET /v1/harness/runs": () => ({ runs: [], running: false }),
      "POST /v1/harness/runs": () => [status, { error: status === 400 ? "the code agent is turned off ([harness] code_agent_enabled)" : "a run is already going: wait for it to end, or stop it" }],
    });
    const user = userEvent.setup();
    render(<CodePage />);
    await screen.findByText(/No runs yet/);
    await user.type(screen.getByLabelText("The task"), "Write a function f(x) that doubles x.");
    await user.type(screen.getByLabelText("Tests it must pass"), "assert f(2) == 4");
    await user.click(screen.getByRole("button", { name: "Write and check" }));
    expect(await screen.findByText(/The run could not be started: the code agent is turned off/)).toBeInTheDocument();
    status = 409;
    await user.click(screen.getByRole("button", { name: "Write and check" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(expect.stringMatching(/A run is already going/)));
  });

  it("reopens an earlier run and puts its task and tests back in the form", async () => {
    serve({
      "GET /v1/harness": () => HARNESS,
      "GET /v1/system": () => SYSTEM_OK,
      "GET /v1/harness/runs": () => ({ runs: [{ id: RID, status: "verified", task: "Write a function median(xs) that returns the median.", created_at: new Date().toISOString(), steps: 2, passed: true, wall_ms: 8400 }], running: false }),
      [`GET /v1/harness/runs/${RID}`]: () => verified(),
    });
    const user = userEvent.setup();
    render(<CodePage />);
    await user.click(await screen.findByRole("button", { name: /All the tests pass.*median/ }));
    await user.click(await screen.findByRole("button", { name: /Use these again/ }));
    expect(screen.getByLabelText("The task")).toHaveValue("Write a function median(xs) that returns the median.");
    expect(screen.getByLabelText("Tests it must pass")).toHaveValue("assert median([1, 3, 2]) == 2");
  });

  it("follows a run that is already going, gives up after repeated failures, and stops polling on unmount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    serve({
      "GET /v1/harness": () => HARNESS,
      "GET /v1/system": () => SYSTEM_OK,
      "GET /v1/harness/runs": () => ({ runs: [{ id: RID, status: "running", task: "Write a function median(xs).", created_at: new Date().toISOString(), steps: 0 }], running: true }),
      [`GET /v1/harness/runs/${RID}`]: () => [502, { error: "The Semantic Duo gateway is unreachable" }],
    });
    const { unmount } = render(<CodePage />);
    expect(await screen.findByText(/could not be read just now; trying again/)).toBeInTheDocument();
    for (let i = 0; i < MAX_FAILURES; i++) await act(() => vi.advanceTimersByTimeAsync(RETRY_MS + 10));
    expect(await screen.findByText("The Semantic Duo gateway is unreachable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
    const n = calls().filter((c) => c === `GET /v1/harness/runs/${RID}`).length;
    expect(n).toBe(MAX_FAILURES);
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(RETRY_MS * 5));
    expect(calls().filter((c) => c === `GET /v1/harness/runs/${RID}`).length).toBe(n);
  });

  it("clears Stopping… when the following gives up", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let gone = false;
    serve({
      "GET /v1/harness": () => HARNESS,
      "GET /v1/system": () => SYSTEM_OK,
      "GET /v1/harness/runs": () => ({ runs: [{ id: RID, status: "running", task: "Write a function median(xs).", created_at: new Date().toISOString(), steps: 1 }], running: true }),
      [`GET /v1/harness/runs/${RID}`]: () => (gone ? [404, { error: "run not found" }] : running([step(1)])),
      [`POST /v1/harness/runs/${RID}/stop`]: () => ({ stopping: true }),
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<CodePage />);
    await user.click(await screen.findByRole("button", { name: "Stop" }));
    expect(await screen.findByRole("button", { name: /Stopping after this step/ })).toBeDisabled();
    gone = true;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS + 10));
    expect(await screen.findByText(/run not found/)).toBeInTheDocument();
    expect(screen.queryByText(/Stopping after this step/)).not.toBeInTheDocument();
  });

  it("shows the not-configured state", async () => {
    fetchMock.mockImplementation(() => json({ error: "Semantic Duo is not configured (DUO_GATEWAY_URL)" }, 503));
    render(<CodePage />);
    expect(await screen.findByText("Semantic Duo is not configured")).toBeInTheDocument();
  });
});
