import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LearningPage, readiness } from "@/modules/duo/components/learning/learning-page";
import { ReviewQueue } from "@/modules/duo/components/learning/review-queue";

const TAZKIYA = {
  ledger: {
    domains: [
      { domain: "math", verified_slow: 40, verified_fast: 5, consensus_approved: 10, consensus_pending: 2, abstained: 1, replies: 80 },
      { domain: "code", verified_slow: 10, verified_fast: 0, consensus_approved: 0, consensus_pending: 0, abstained: 0, replies: 20 },
    ],
    opted_out_conversations: 3,
    feedback: { up: 7, down: 2 },
    reviews: { approved: 4, rejected: 1 },
  },
  registry: null,
  retention_days: 30,
  active_models: { system1: "Qwen/Qwen3-1.7B", system2: "Qwen/Qwen3-4B-Thinking-2507", adapter_hash: "none" },
  rules: { "FR-033": "consensus answers only after human approval" },
};
const QUEUE = [
  { reply_id: "r1", created_at: new Date().toISOString(), domain: "math", mode: "fast", question: "What is 6 x 7?", answer: "**42**" },
  { reply_id: "r2", created_at: new Date().toISOString(), domain: "factual", mode: "slow", question: null, answer: "Paris" },
];

// jsdom has no pointer capture; the toast (Undo) uses it when pressed.
if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => undefined;
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => undefined;

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status }));
const posts = () => fetchMock.mock.calls.filter(([, i]) => i?.method === "POST");

function routes({ tazkiya = TAZKIYA as unknown, queue = QUEUE as unknown, review = () => json(null, 204) } = {}) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    const path = url.replace("/api/duo/gw", "").split("?")[0];
    if (init?.method === "POST" && path.startsWith("/v1/tazkiya/review/")) return review();
    if (path === "/v1/tazkiya/review") return queue instanceof Response ? Promise.resolve(queue) : json(queue);
    if (path === "/v1/tazkiya") return tazkiya instanceof Response ? Promise.resolve(tazkiya) : json(tazkiya);
    return json({});
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  try {
    window.localStorage.clear();
  } catch {
    /* no storage */
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("readiness", () => {
  it("counts checked thorough and approved answers, and flags a topic above 30% of a mixed set", () => {
    const { rows, total } = readiness(TAZKIYA.ledger);
    expect(total).toBe(60);
    expect(rows[0]).toMatchObject({ domain: "math", ready: 50, overCap: true });
    expect(rows[0].share).toBeCloseTo(50 / 60);
    expect(rows[1]).toMatchObject({ domain: "code", ready: 10, overCap: false });
  });

  it("is empty and never over the cap with one topic or no data", () => {
    expect(readiness({})).toEqual({ rows: [], total: 0 });
    expect(readiness({ domains: [{ domain: "math", verified_slow: 5 }] }).rows[0].overCap).toBe(false);
  });
});

describe("LearningPage", () => {
  it("shows readiness, opt-outs, feedback and the queue", async () => {
    routes();
    render(<LearningPage />);
    expect(await screen.findByText(/of about 5,000 examples ready/)).toBeInTheDocument();
    expect(screen.getByText("Chats left out").nextSibling).toHaveTextContent("3");
    expect(screen.getByText("thumbs up / down").previousSibling).toHaveTextContent("7 / 2");
    expect(screen.getByText("above 30%: only part is used")).toBeInTheDocument();
    expect(screen.getByText("consensus answers only after human approval")).toBeInTheDocument();
    expect(screen.getByText("none yet")).toBeInTheDocument();
    expect(await screen.findByText("What is 6 x 7?")).toBeInTheDocument();
    expect(screen.getByText("(question not stored)")).toBeInTheDocument();
  });

  it("handles a fresh install: nothing collected, nothing to review", async () => {
    routes({ tazkiya: { ...TAZKIYA, ledger: { domains: [] } }, queue: [] });
    render(<LearningPage />);
    expect(await screen.findByText(/No live conversations yet/)).toBeInTheDocument();
    expect(await screen.findByText(/Nothing to review/)).toBeInTheDocument();
  });

  it("shows the gateway error with a retry", async () => {
    routes({ tazkiya: new Response(JSON.stringify({ error: "database locked" }), { status: 500 }) });
    render(<LearningPage />);
    expect(await screen.findByText("Could not load the learning summary")).toBeInTheDocument();
    expect(screen.getByText("database locked")).toBeInTheDocument();
  });
});

describe("ReviewQueue", () => {
  function setup(undoMs = 40) {
    const user = userEvent.setup();
    render(
      <>
        <ReviewQueue undoMs={undoMs} />
        <Toaster />
      </>
    );
    return user;
  }

  it("approves at once on screen and sends after the undo window", async () => {
    routes();
    const user = setup();
    await user.click(await screen.findByRole("button", { name: /Approve: What is 6 x 7/ }));
    expect(screen.queryByText("What is 6 x 7?")).not.toBeInTheDocument();
    expect(posts()).toHaveLength(0);
    await waitFor(() => expect(posts()).toHaveLength(1));
    const [url, init] = posts()[0];
    expect(url).toBe("/api/duo/gw/v1/tazkiya/review/r1");
    expect(JSON.parse(String(init.body))).toEqual({ approved: true, reviewer: "operator" });
  });

  it("Undo puts the answer back and sends nothing", async () => {
    routes();
    const user = setup(2000);
    await user.click(await screen.findByRole("button", { name: /Reject: What is 6 x 7/ }));
    expect(screen.queryByText("What is 6 x 7?")).not.toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    expect(await screen.findByText("What is 6 x 7?")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(posts()).toHaveLength(0);
  });

  it("brings the answer back when the gateway refuses the decision", async () => {
    routes({ review: () => json({ error: "reply not found" }, 404) });
    const user = setup();
    await user.click(await screen.findByRole("button", { name: /Approve: What is 6 x 7/ }));
    expect(await screen.findByText("The approval was not saved")).toBeInTheDocument();
    expect(await screen.findByText("What is 6 x 7?")).toBeInTheDocument();
  });

  it("records the reviewer's name", async () => {
    routes();
    const user = setup();
    await user.type(await screen.findByLabelText("Reviewing as"), "dina");
    await user.click(await screen.findByRole("button", { name: /Reject: answer/ }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(JSON.parse(String(posts()[0][1].body))).toEqual({ approved: false, reviewer: "dina" });
  });

  it("sends a decision still waiting for its undo window when the page closes", async () => {
    routes();
    const user = userEvent.setup();
    const { unmount } = render(<ReviewQueue undoMs={60_000} />);
    await user.click(await screen.findByRole("button", { name: /Approve: What is 6 x 7/ }));
    expect(posts()).toHaveLength(0);
    unmount();
    expect(posts()).toHaveLength(1);
    expect(posts()[0][1].keepalive).toBe(true);
  });

  it("sends a waiting decision with keepalive when the tab is closed or hidden", async () => {
    routes();
    const user = userEvent.setup();
    const { unmount } = render(<ReviewQueue undoMs={60_000} />);
    await user.click(await screen.findByRole("button", { name: /Approve: What is 6 x 7/ }));
    window.dispatchEvent(new Event("pagehide"));
    expect(posts()).toHaveLength(1);
    const [url, init] = posts()[0];
    expect(url).toBe("/api/duo/gw/v1/tazkiya/review/r1");
    expect(init.keepalive).toBe(true);
    expect(JSON.parse(String(init.body))).toEqual({ approved: true, reviewer: "operator" });

    await user.click(await screen.findByRole("button", { name: /Reject: answer/ }));
    const vis = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    vis.mockRestore();
    expect(posts()).toHaveLength(2);
    expect(JSON.parse(String(posts()[1][1].body))).toEqual({ approved: false, reviewer: "operator" });
    // nothing is sent twice when the page then goes away
    unmount();
    expect(posts()).toHaveLength(2);
  });
});
