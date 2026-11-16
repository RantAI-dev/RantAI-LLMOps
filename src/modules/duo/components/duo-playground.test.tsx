import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DuoTrace } from "@/lib/duo";
import { DuoPlayground } from "@/modules/duo/components/duo-playground";

const trace = (over: Partial<DuoTrace> = {}): DuoTrace => ({
  answer: "Answer: 144",
  mode: "fast",
  assurance: "consensus",
  uncertaintyNotice: null,
  degraded: false,
  domain: "math",
  gate: { escalate: false, rule: "fixed", lambda: 0.2, errorFast: 0.04, errorSlow: 0.02, agreement: 1, meanLogprob: -0.01, verifiable: false, explanation: null },
  verifier: null,
  stages: [
    { stage: "draft", ms: 689, tokens: 39, note: null },
    { stage: "sample_after", ms: 685, tokens: 77, note: null },
  ],
  usage: { wallMs: 1378, ttftMs: 63, promptTokens: 366, completionTokens: 116, reasoningTokens: 0, modelCalls: 3, verifierCalls: 0 },
  reasoning: null,
  conversationId: null,
  ...over,
});

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("DuoPlayground", () => {
  it("says so when the gateway is not configured", async () => {
    fetchMock.mockImplementation(() => json({ configured: false }));
    render(<DuoPlayground />);
    expect(await screen.findByText(/not configured/i)).toBeInTheDocument();
  });

  it("sends the conversation and shows which system answered, with its trace", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "POST" ? json(trace()) : json({ configured: true })
    );
    const user = userEvent.setup();
    render(<DuoPlayground />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeDisabled());
    await user.type(screen.getByLabelText("Question"), "What is 12 * 12?");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("Answer: 144")).toBeInTheDocument();
    expect(screen.getByText("System 1")).toBeInTheDocument();
    expect(screen.getByText("Cross-checked")).toBeInTheDocument();

    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(post[1].body)).toEqual({ messages: [{ role: "user", content: "What is 12 * 12?" }], mode: "auto" });

    await user.click(screen.getByRole("button", { name: /trace/i }));
    const t = screen.getByTestId("duo-trace");
    expect(t).toHaveTextContent("Escalated: no");
    expect(t).toHaveTextContent("sample_after");
    expect(t).toHaveTextContent("3 model calls");
  });

  it("forces System 2 in Careful mode and shows its checker", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? json(trace({ mode: "slow", verifier: { name: "judge", passed: true, score: 1, ms: 13128 }, reasoning: "thinking…" }))
        : json({ configured: true })
    );
    const user = userEvent.setup();
    render(<DuoPlayground />);
    await user.click(await screen.findByRole("radio", { name: "Careful" }));
    await user.type(screen.getByLabelText("Question"), "Prove it");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("System 2")).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(post[1].body).mode).toBe("slow");
    await user.click(screen.getByRole("button", { name: /trace/i }));
    expect(screen.getByTestId("duo-trace")).toHaveTextContent("judge, passed");
  });

  it("shows a server error and keeps the question to retry", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === "POST" ? json({ error: "Duo gateway 503: backend unavailable" }, 503) : json({ configured: true })
    );
    const user = userEvent.setup();
    render(<DuoPlayground />);
    await user.type(await screen.findByLabelText("Question"), "hello");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText(/backend unavailable/)).toBeInTheDocument();
    expect(screen.getByLabelText("Question")).toHaveValue("hello");
  });
});
