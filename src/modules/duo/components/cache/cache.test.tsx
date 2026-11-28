import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DuoCache } from "@/modules/duo/components/cache/cache-page";

const ENTRY = {
  id: "arc-1",
  created_at: "2026-11-20T10:00:00Z",
  domain: "math",
  question: "How many divisors does 360 have?",
  template: "How many divisors does {n} have?",
  params: [{ name: "n", type: "int", description: "the number", value: "360" }],
  status: "candidate",
  stats: { hits: 5, served: 0, agreements: 2, disagreements: 0, min_agreed: 0.83 },
  functions: [{ name: "count_divisors", description: "count the divisors", root: true }],
  reused: 0,
};
const TRUSTED = { ...ENTRY, id: "arc-2", question: "What is 15% of 240?", template: "What is {p}% of {x}?", status: "trusted", stats: { hits: 9, served: 7, agreements: 3, disagreements: 1 } };
const ARC = {
  enabled: true,
  serve: true,
  build: true,
  trust_after: 3,
  domains: ["math"],
  counts: { trusted: 1, candidate: 1, quarantined: 0 },
  hits: 14,
  served: 7,
  functions: 2,
  entries: [ENTRY, TRUSTED],
  queue: [{ question: "A shop sells pens at 3 for $2…", domain: "math", attempts: 1 }],
};
const DETAIL = { ...ENTRY, code: "def count_divisors(n):\n    ...", narration: ["360 = 2^3 · 3^2 · 5", "(3+1)(2+1)(1+1) = 24"], expected: "24", floor: 0.85, build: { rounds: 2, ms: 4000 } };

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
const bodyOf = (key: string) => {
  const c = fetchMock.mock.calls.find(([url, init]) => `${init?.method ?? "GET"} ${String(url).replace(/^\/api\/duo\/gw/, "")}` === key);
  return c ? JSON.parse(String(c[1]!.body)) : undefined;
};

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("DuoCache", () => {
  it("explains a cache that is turned off", async () => {
    routes({ "GET /v1/arc": { enabled: false, entries: [], queue: [] } });
    render(<DuoCache />);
    expect(await screen.findByText("The reasoning cache is off")).toBeInTheDocument();
    expect(screen.getByText("[arc] enabled = true")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try/i })).not.toBeInTheDocument();
  });

  it("shows the counts, settings, queue and stored methods, and filters them", async () => {
    routes({ "GET /v1/arc": ARC });
    render(<DuoCache />);
    expect(await screen.findByText("Methods that answer")).toBeInTheDocument();
    expect(screen.getByText("each needs 3 agreements")).toBeInTheDocument();
    expect(screen.getByText("Waiting to be built (1)")).toBeInTheDocument();
    expect(screen.getByText("0.83")).toBeInTheDocument(); // the learned floor of the first entry
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: /answers \(1\)/i }));
    expect(screen.queryByText("How many divisors does 360 have?")).not.toBeInTheDocument();
    expect(screen.getByText("What is 15% of 240?")).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /all/i }));
    await user.type(screen.getByLabelText("Search methods"), "divisors");
    expect(screen.queryByText("What is 15% of 240?")).not.toBeInTheDocument();
  });

  it("has an empty state", async () => {
    routes({ "GET /v1/arc": { ...ARC, entries: [], queue: [], counts: { trusted: 0, candidate: 0, quarantined: 0 } } });
    render(<DuoCache />);
    expect(await screen.findByText("Nothing stored yet")).toBeInTheDocument();
  });

  it("opens a method, lets it answer, and deletes it after a second click", async () => {
    routes({
      "GET /v1/arc": ARC,
      "GET /v1/arc/arc-1": DETAIL,
      "POST /v1/arc/arc-1/status": { ...ENTRY, status: "trusted" },
      "DELETE /v1/arc/arc-1": { deleted: "arc-1" },
    });
    render(<DuoCache />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "How many divisors does 360 have?" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/\(3\+1\)\(2\+1\)\(1\+1\) = 24/)).toBeInTheDocument();
    expect(within(dialog).getByText("0.85")).toBeInTheDocument();
    expect(within(dialog).getByText("the number")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Let it answer" }));
    await waitFor(() => expect(bodyOf("POST /v1/arc/arc-1/status")).toEqual({ status: "trusted" }));
    // "Put on trial" is the current state, so it is disabled
    expect(within(dialog).getByRole("button", { name: "Put on trial" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: /delete/i }));
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === "DELETE")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: /click again to delete/i }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === "DELETE")).toBe(true));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("tries a question against the cache alone", async () => {
    let hit = true;
    routes({
      "GET /v1/arc": ARC,
      "POST /v1/arc/try": () =>
        json(
          hit
            ? { hit: true, entry: "arc-1", status: "trusted", tier: "meaning", similarity: 0.91, answer: "24", narration: ["360 = 2^3 · 3^2 · 5"], ms: 1200, run_ms: 30 }
            : { hit: false, why: "no entry matched", ms: 4 }
        ),
    });
    render(<DuoCache />);
    const user = userEvent.setup();
    const box = await screen.findByLabelText("Question", { selector: "#arc-try" });
    expect(screen.getByRole("button", { name: /^try$/i })).toBeDisabled();
    await user.type(box, "How many divisors does 360 have?");
    await user.click(screen.getByRole("button", { name: /^try$/i }));
    expect(await screen.findByText("24")).toBeInTheDocument();
    expect(screen.getByText(/Found by its meaning \(similarity 0.91\)/)).toBeInTheDocument();
    expect(bodyOf("POST /v1/arc/try")).toEqual({ question: "How many divisors does 360 have?" });
    hit = false;
    await user.click(screen.getByRole("button", { name: /^try$/i }));
    expect(await screen.findByText("no entry matched")).toBeInTheDocument();
    expect(screen.getByText("Not answered from the cache")).toBeInTheDocument();
  });

  it("compiles the methods into one Python file", async () => {
    routes({ "GET /v1/arc": ARC, "POST /v1/arc/compile": { path: "/data/arc/arc_cache.py", entries: 1, skipped: [], bytes: 2048, usage: 'python3 arc_cache.py "<question>"' } });
    render(<DuoCache />);
    const user = userEvent.setup();
    await user.click(await screen.findByLabelText("Include methods on trial"));
    await user.click(screen.getByRole("button", { name: /^export$/i }));
    expect(await screen.findByText("/data/arc/arc_cache.py")).toBeInTheDocument();
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
    expect(bodyOf("POST /v1/arc/compile")).toEqual({ all: true });
  });

  it("queues a question to build a method from", async () => {
    routes({ "GET /v1/arc": ARC, "POST /v1/arc/build": { queued: true, queue: 2 } });
    render(<DuoCache />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Question", { selector: "#arc-teach-q" }), "What is 7 times 8?");
    await user.type(screen.getByLabelText("Correct answer"), "56");
    await user.click(screen.getByRole("button", { name: /queue for building/i }));
    await waitFor(() => expect(bodyOf("POST /v1/arc/build")).toEqual({ question: "What is 7 times 8?", expected: "56", domain: "math" }));
  });

  it("shows the gateway error with a retry", async () => {
    routes({ "GET /v1/arc": () => json({ message: "boom" }, 500) });
    render(<DuoCache />);
    expect(await screen.findByText("Could not load the reasoning cache")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
