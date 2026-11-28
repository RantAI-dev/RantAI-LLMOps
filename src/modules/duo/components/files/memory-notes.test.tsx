import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toast } = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("sonner", () => ({ toast }));

import { MemoryNotes } from "@/modules/duo/components/files/memory-notes";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status }));
const calls = () => fetchMock.mock.calls.map(([u, i]) => `${(i as RequestInit | undefined)?.method ?? "GET"} ${String(u).replace("/api/duo/gw", "")}`);

const now = Date.now();
const items = [
  { id: "a", created_at: new Date(now - 3_600_000).toISOString(), kind: "turn", text: "The user deploys on a GB10 box", access_count: 2 },
  { id: "b", created_at: new Date(now - 60_000).toISOString(), kind: "note", text: "My server listens on port 8443", access_count: 0 },
];

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  vi.clearAllMocks();
});

describe("MemoryNotes", () => {
  it("lists the notes newest first and adds one", async () => {
    let posted: unknown = null;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posted = JSON.parse(String(init.body));
        return json({ id: "c" }, 201);
      }
      return json({ enabled: true, count: 2, items });
    });
    const user = userEvent.setup();
    render(<MemoryNotes />);
    const list = await screen.findByRole("list", { name: "Notes, newest first" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("My server listens on port 8443");
    expect(rows[0]).toHaveTextContent("You asked to keep this");
    expect(rows[1]).toHaveTextContent("used 2 times");
    expect(screen.getByText(/2 notes from earlier conversations are kept/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("A note to remember"), "I prefer short answers{Enter}");
    await waitFor(() => expect(posted).toEqual({ text: "I prefer short answers" }));
    await waitFor(() => expect(screen.getByLabelText("A note to remember")).toHaveValue(""));
  });

  it("forgets one note only after a second click, with no fake undo", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => (init?.method === "DELETE" ? json(null, 204) : json({ enabled: true, count: 2, items })));
    const user = userEvent.setup();
    render(<MemoryNotes />);
    await user.click(await screen.findByRole("button", { name: /Forget this note: My server/ }));
    expect(calls()).not.toContain("DELETE /v1/memory/b");
    await user.click(screen.getByRole("button", { name: "Click again to forget" }));
    await waitFor(() => expect(calls()).toContain("DELETE /v1/memory/b"));
    expect(toast.success).toHaveBeenCalledWith("Forgotten");
    expect(toast).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === "POST")).toBe(false);
  });

  it("keeps the notes on screen when a refresh fails", async () => {
    let fail = false;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        fail = true;
        return json({ id: "c" }, 201);
      }
      return fail ? json({ message: "gateway timed out" }, 502) : json({ enabled: true, count: 2, items });
    });
    const user = userEvent.setup();
    render(<MemoryNotes />);
    await user.type(await screen.findByLabelText("A note to remember"), "x{Enter}");
    expect(await screen.findByText(/Could not refresh/)).toBeInTheDocument();
    expect(screen.getByText("My server listens on port 8443")).toBeInTheDocument();
  });

  it("forgets everything only after the word is typed", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => (init?.method === "DELETE" ? json({ forgotten: 2 }) : json({ enabled: true, count: 2, items })));
    const user = userEvent.setup();
    render(<MemoryNotes />);
    await user.click(await screen.findByRole("button", { name: /Forget everything/ }));
    const dialog = await screen.findByRole("dialog");
    const go = within(dialog).getByRole("button", { name: "Forget everything" });
    expect(go).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Type forget to confirm/), "forget");
    expect(go).toBeEnabled();
    await user.click(go);
    await waitFor(() => expect(calls()).toContain("DELETE /v1/memory"));
    expect(toast.success).toHaveBeenCalledWith("Everything was forgotten (2 notes)");
  });

  it("merges repeated notes", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => (init?.method === "POST" ? json({ merged: 1, count: 1 }) : json({ enabled: true, count: 2, items })));
    const user = userEvent.setup();
    render(<MemoryNotes />);
    await user.click(await screen.findByRole("button", { name: /Merge repeated notes/ }));
    await waitFor(() => expect(calls()).toContain("POST /v1/memory/tidy"));
    expect(toast.success).toHaveBeenCalledWith("1 repeated note merged");
  });

  it("says when nothing is remembered and remembering is off", async () => {
    fetchMock.mockImplementation(() => json({ enabled: false, count: 0, items: [] }));
    render(<MemoryNotes />);
    expect(await screen.findByText("Nothing is remembered yet")).toBeInTheDocument();
    expect(screen.getByText(/turned off on this service/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Forget everything/ })).not.toBeInTheDocument();
  });

  it("shows the gateway error", async () => {
    fetchMock.mockImplementation(() => json({ error: "Semantic Duo is not configured" }, 503));
    render(<MemoryNotes />);
    expect(await screen.findByText("Semantic Duo is not configured")).toBeInTheDocument();
  });
});
