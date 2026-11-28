import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));

import { DuoChat } from "@/modules/duo/components/chat/duo-chat";

const sse = (events: Array<[string, unknown]>) =>
  new Response(events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify({ event: e, data: d })}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

const DONE = {
  reply_id: "rep1",
  conversation_id: "c1",
  decision_id: "dec1",
  reasoning_mode: "fast",
  assurance: "verified",
  message: { role: "assistant", content: "The trip takes **145** minutes." },
  usage: { wall_ms: 1400, ttft_ms: 60, model_calls: 2, verifier_calls: 1, prompt_tokens: 50, completion_tokens: 20, reasoning_tokens: 0, stages: [{ stage: "draft", ms: 700 }] },
  decision: { escalate: false, rule: "verified_draft", explanation: "draft passed the check", e1_hat: 0.02, e2_hat: 0.01, features: { domain: "math" } },
  states: ["A", "T"],
  sources: [],
};

const fetchMock = vi.fn();
let streamBody: () => Response;
let lastStreamRequest: Record<string, unknown> | null = null;

beforeEach(() => {
  lastStreamRequest = null;
  streamBody = () =>
    sse([
      ["start", { request_id: "r1", conversation_id: "c1", domain: "math", backend: "vllm" }],
      ["token", { text: "The trip takes **145** minutes.", mode: "fast", reasoning: false, round: 0 }],
      ["decision", DONE.decision],
      ["done", DONE],
    ]);
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/v1/conversations")) return json([]);
    if (url.endsWith("/v1/kb/status")) return json({ enabled: false });
    if (url.endsWith("/v1/chat/stream")) {
      lastStreamRequest = JSON.parse(String(init?.body ?? "{}"));
      return streamBody();
    }
    if (url.includes("/v1/replies/rep1/feedback")) return json({ ok: true });
    if (url.endsWith("/v1/conversations/c1"))
      return json({ conversation_id: "c1", messages: [{ role: "user", content: "Earlier" }, { role: "assistant", content: "x" }, { role: "user", content: "First" }, { role: "assistant", content: "y" }] });
    return json({ message: "unexpected " + url }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("DuoChat", () => {
  it("streams an answer with its route and assurance, then rates it", async () => {
    const user = userEvent.setup();
    render(<DuoChat />);
    await user.type(screen.getByLabelText("Your message"), "How many minutes?{Enter}");
    expect(await screen.findByText("145")).toBeInTheDocument();
    expect(screen.getByText("Quick answer")).toBeInTheDocument();
    expect(screen.getByText("Checked")).toBeInTheDocument();
    expect(lastStreamRequest).toMatchObject({ messages: [{ role: "user", content: "How many minutes?" }], show_reasoning: false });
    expect(lastStreamRequest).not.toHaveProperty("force_mode");
    await user.click(screen.getByRole("button", { name: "Good answer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/duo/gw/v1/replies/rep1/feedback", expect.objectContaining({ method: "POST" })));
  });

  it("sends the chosen mode and continues the same conversation", async () => {
    const user = userEvent.setup();
    render(<DuoChat />);
    await user.click(screen.getByRole("radio", { name: "Careful" }));
    await user.type(screen.getByLabelText("Your message"), "First{Enter}");
    await screen.findByText("145");
    await user.type(screen.getByLabelText("Your message"), "Second{Enter}");
    await waitFor(() => expect(lastStreamRequest).toMatchObject({ conversation_id: "c1", force_mode: "slow" }));
  });

  it("shows the gateway's error when the answer fails", async () => {
    streamBody = () => json({ message: "System 1 is not reachable" }, 502);
    const user = userEvent.setup();
    render(<DuoChat />);
    await user.type(screen.getByLabelText("Your message"), "Hi{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("System 1 is not reachable");
  });

  it("reports a stream that ends without an answer", async () => {
    streamBody = () => sse([["start", { request_id: "r", domain: "open", backend: "vllm" }]]);
    const user = userEvent.setup();
    render(<DuoChat />);
    await user.type(screen.getByLabelText("Your message"), "Hi{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("stopped early");
  });

  it("fills the composer from an example with a check attached", async () => {
    const user = userEvent.setup();
    render(<DuoChat />);
    await user.click(screen.getByRole("button", { name: /Check a calculation/ }));
    expect(screen.getByLabelText("Your message")).toHaveValue("A train leaves at 3:40 pm and arrives at 6:05 pm the same day. How many minutes is the trip?");
    expect(screen.getByText("The answer will be checked")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(lastStreamRequest).toMatchObject({ verification: { reference_answer: "145" } }));
  });

  it("says when Semantic Duo is not configured", async () => {
    fetchMock.mockImplementation(async () => json({ error: "Semantic Duo is not configured" }, 503));
    render(<DuoChat />);
    expect(await screen.findByText("Semantic Duo is not configured")).toBeInTheDocument();
  });

  it("does not attach a new chat to the conversation of an answer it stopped", async () => {
    let release: () => void = () => undefined;
    streamBody = () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode(`event: start\ndata: ${JSON.stringify({ event: "start", data: { request_id: "r", conversation_id: "c1", domain: "open", backend: "vllm" } })}\n\n`));
            release = () => c.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } }
      );
    const user = userEvent.setup();
    render(<DuoChat />);
    await user.type(screen.getByLabelText("Your message"), "Slow one{Enter}");
    await screen.findByRole("button", { name: "Stop the answer" });
    await user.click(screen.getAllByRole("button", { name: /New chat/ })[0]);
    release();
    streamBody = () => sse([["done", { ...DONE, conversation_id: "c2" }]]);
    await user.type(screen.getByLabelText("Your message"), "Fresh{Enter}");
    await waitFor(() => expect(lastStreamRequest).toMatchObject({ messages: [{ content: "Fresh" }] }));
    expect(lastStreamRequest).not.toHaveProperty("conversation_id");
  });

  it("regenerates from the stored position of the question", async () => {
    const user = userEvent.setup();
    render(<DuoChat />);
    await user.type(screen.getByLabelText("Your message"), "First{Enter}");
    await screen.findByText("145");
    await user.click(screen.getByRole("button", { name: /Regenerate/ }));
    await waitFor(() => expect(lastStreamRequest).toMatchObject({ conversation_id: "c1", rewind_to: 2, messages: [{ content: "First" }] }));
  });
});
