import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => {
  const toast = Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() });
  return { toast };
});

import { FsBrowser } from "@/modules/duo/components/files/fs-browser";
import { labelOf, parentOf, slug, trail } from "@/modules/duo/components/files/fs-lib";

type Handler = (url: URL, init: RequestInit | undefined) => unknown;
const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => Promise.resolve(new Response(body === null ? null : JSON.stringify(body), { status }));

/** Answers by method + gateway path; a handler may return [status, body]. */
function serve(routes: Record<string, Handler>) {
  fetchMock.mockImplementation((input: string, init?: RequestInit) => {
    const url = new URL(input, "http://x");
    const path = url.pathname.replace(/^\/api\/duo\/gw/, "");
    const key = `${init?.method ?? "GET"} ${path}`;
    const h = routes[key];
    if (!h) return json({ error: `no mock for ${key}` }, 404);
    const out = h(url, init);
    if (Array.isArray(out) && typeof out[0] === "number") return json(out[1], out[0]);
    return json(out);
  });
}

const ROOT_LS = {
  uri: "nafs://",
  parent: null,
  items: [
    { uri: "nafs://kb", name: "kb", dir: true, l0: "Knowledge bases: documents and their passages" },
    { uri: "nafs://memory", name: "memory", dir: true, l0: "What the assistant remembers about you" },
    { uri: "nafs://skills", name: "skills", dir: true, l0: "How to do tasks" },
    { uri: "nafs://sessions", name: "sessions", dir: true, l0: "Conversations saved as files" },
  ],
};
const MEM_LS = {
  uri: "nafs://memory",
  parent: "nafs://",
  items: [
    { uri: "nafs://memory/profile", name: "profile", dir: true, l0: "profile: who you are (0 files)", files: 0 },
    { uri: "nafs://memory/notes", name: "notes", dir: true, l0: "notes: things you asked to be remembered (1 file)", files: 1 },
  ],
};
const NOTES_LS = {
  uri: "nafs://memory/notes",
  parent: "nafs://memory",
  items: [{ uri: "nafs://memory/notes/answer-language", name: "answer-language", dir: false, l0: "Answer in English", title: "Answer language" }],
};
const read = (uri: string, kind: string, content: string, meta: Record<string, unknown> = {}) => ({ uri, kind, level: 1, content, meta });

const lsOf = (url: URL) => url.searchParams.get("uri");

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe("fs-lib", () => {
  it("names folders in plain words and finds parents", () => {
    expect(labelOf("nafs://memory", "memory", {})).toBe("Memory");
    expect(labelOf("nafs://memory/entities", "entities", {})).toBe("People and things");
    expect(labelOf("nafs://kb/Laporan%20Tahunan", "Laporan%20Tahunan", {})).toBe("Laporan Tahunan");
    expect(labelOf("nafs://kb/b1", "b1", { "nafs://kb/b1": "Annual report" })).toBe("Annual report");
    expect(parentOf("nafs://kb/b/d#p3")).toBe("nafs://kb/b/d");
    expect(parentOf("nafs://memory/notes/x")).toBe("nafs://memory/notes");
    expect(parentOf("nafs://skills")).toBe("nafs://");
    expect(trail("nafs://memory/notes").map((t) => t.uri)).toEqual(["nafs://", "nafs://memory", "nafs://memory/notes"]);
    expect(slug("  Bahasa Jawab — Café!! ")).toBe("bahasa-jawab-cafe");
  });
});

describe("FsBrowser", () => {
  it("lists the root with summaries and reads it as an overview", async () => {
    serve({
      "GET /v1/fs/ls": () => ROOT_LS,
      "GET /v1/fs/read": () => read("nafs://", "root", "Everything the assistant knows"),
    });
    render(<FsBrowser />);
    expect(await screen.findByRole("button", { name: /Memory.*What the assistant remembers/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Saved chats/ })).toBeInTheDocument();
    expect(await screen.findByText("Everything the assistant knows")).toBeInTheDocument();
    const readCall = fetchMock.mock.calls.map(([u]) => String(u)).find((u) => u.includes("/v1/fs/read"))!;
    expect(readCall).toBe("/api/duo/gw/v1/fs/read?uri=nafs%3A%2F%2F&level=1");
    // The root is read only: no edit or delete.
    expect(screen.queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
  });

  it("opens a memory file inside its folder, with edit and delete, and deletes it after a second click", async () => {
    const calls: string[] = [];
    serve({
      "GET /v1/fs/ls": (u) => (lsOf(u) === "nafs://memory" ? MEM_LS : lsOf(u) === "nafs://memory/notes" ? NOTES_LS : ROOT_LS),
      "GET /v1/fs/read": (u) => {
        const uri = lsOf(u)!;
        if (uri === "nafs://memory/notes/answer-language") return read(uri, "memory", "# Answer language\nAnswer in English", { title: "Answer language", updated: new Date().toISOString() });
        return read(uri, "directory", `Folder ${uri}`);
      },
      "GET /v1/memory/diff": () => ({ diff: [] }),
      "DELETE /v1/fs/rm": (u) => {
        calls.push(lsOf(u)!);
        return { removed: lsOf(u) };
      },
    });
    const user = userEvent.setup();
    render(<FsBrowser />);
    await user.click(await screen.findByRole("button", { name: /^Memory/ }));
    expect(await screen.findByText("No changes yet.")).toBeInTheDocument(); // the memory folder shows its change history
    expect(screen.getByRole("button", { name: /New memory/ })).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /^Notes/ }));
    await user.click(await screen.findByRole("button", { name: /Answer language.*Answer in English/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "Answer language" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Path" })).toHaveTextContent(/All.*Memory.*Notes/);

    const del = screen.getByRole("button", { name: "Delete" });
    await user.click(del);
    expect(calls).toEqual([]); // the first click only asks
    await user.click(screen.getByRole("button", { name: /Click again to delete/ }));
    await waitFor(() => expect(calls).toEqual(["nafs://memory/notes/answer-language"]));
  });

  it("shows a document read-only and switches the reading level", async () => {
    const uri = "nafs://kb/Laporan%20Tahunan/d1";
    serve({
      "GET /v1/fs/ls": () => ({ uri: "nafs://", parent: null, items: [{ uri, name: "d1", dir: false, title: "Rapport — été 2026" }] }),
      "GET /v1/fs/read": (u) =>
        lsOf(u) === uri ? read(uri, "document", u.searchParams.get("level") === "2" ? "The whole text <!-- page 2 --> here" : "The main points", { title: "Rapport — été 2026", passages: 4 }) : read("nafs://", "root", "All"),
    });
    const user = userEvent.setup();
    render(<FsBrowser />);
    await user.click(await screen.findByRole("button", { name: /Rapport — été 2026/ }));
    expect(await screen.findByText("The main points")).toBeInTheDocument();
    // Unicode and spaces survive the query string (the URI's own %20 is encoded again).
    expect(fetchMock.mock.calls.some(([u]) => String(u) === `/api/duo/gw/v1/fs/read?uri=${encodeURIComponent(uri)}&level=1`)).toBe(true);
    expect(screen.queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Delete/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Full" }));
    expect(await screen.findByText(/The whole text\s+here/)).toBeInTheDocument();
  });

  it("writes a new memory file under a key made from its title", async () => {
    let put: { url: string; body: unknown } | null = null;
    serve({
      "GET /v1/fs/ls": (u) => (lsOf(u) === "nafs://memory" ? MEM_LS : lsOf(u) === "nafs://memory/preferences" ? { uri: lsOf(u), items: [] } : ROOT_LS),
      "GET /v1/fs/read": (u) => read(lsOf(u)!, lsOf(u)!.split("/").length > 4 ? "memory" : "directory", "x"),
      "GET /v1/memory/diff": () => ({ diff: [] }),
      "PUT /v1/fs/write": (u, init) => {
        put = { url: lsOf(u)!, body: JSON.parse(String(init?.body)) };
        return { uri: lsOf(u), diff: { op: "add" } };
      },
    });
    const user = userEvent.setup();
    render(<FsBrowser />);
    await user.click(await screen.findByRole("button", { name: /^Memory/ }));
    await user.click(await screen.findByRole("button", { name: /New memory/ }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Kind"), "preferences");
    await user.type(within(dialog).getByLabelText("Title"), "Answer language");
    expect(within(dialog).getByText("nafs://memory/preferences/answer-language")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("What to remember"), "Answer in English.");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(put).not.toBeNull());
    expect(put).toEqual({ url: "nafs://memory/preferences/answer-language", body: { content: "# Answer language\nAnswer in English." } });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("asks before a new skill replaces one with the same name", async () => {
    const puts: string[] = [];
    serve({
      "GET /v1/fs/ls": (u) => (lsOf(u) === "nafs://skills" ? { uri: "nafs://skills", items: [] } : ROOT_LS),
      "GET /v1/fs/read": () => read("nafs://", "root", "x"),
      "GET /v1/fs/stat": (u) => (lsOf(u) === "nafs://skills/deploy" ? { uri: lsOf(u), kind: "skill" } : [404, { error: "not found" }]),
      "PUT /v1/fs/write": (u) => {
        puts.push(lsOf(u)!);
        return { uri: lsOf(u) };
      },
    });
    const user = userEvent.setup();
    render(<FsBrowser />);
    await user.click(await screen.findByRole("button", { name: /^Skills/ }));
    await user.click(await screen.findByRole("button", { name: /New skill/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "deploy");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByText(/already exists/)).toBeInTheDocument();
    expect(puts).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Replace it" }));
    await waitFor(() => expect(puts).toEqual(["nafs://skills/deploy"]));
  });

  it("asks before throwing away unsaved text", async () => {
    serve({
      "GET /v1/fs/ls": (u) => (lsOf(u) === "nafs://skills" ? { uri: "nafs://skills", items: [] } : ROOT_LS),
      "GET /v1/fs/read": () => read("nafs://", "root", "x"),
    });
    const user = userEvent.setup();
    render(<FsBrowser />);
    await user.click(await screen.findByRole("button", { name: /^Skills/ }));
    await user.click(await screen.findByRole("button", { name: /New skill/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "release notes");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(within(dialog).getByText(/changes that are not saved/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("searches everywhere and opens a hit", async () => {
    let body: unknown = null;
    serve({
      "GET /v1/fs/ls": () => ROOT_LS,
      "GET /v1/fs/read": (u) => read(lsOf(u)!, lsOf(u) === "nafs://skills/deploy" ? "skill" : "directory", lsOf(u) === "nafs://skills/deploy" ? "Deploy steps" : "x"),
      "POST /v1/fs/search": (_u, init) => {
        body = JSON.parse(String(init?.body));
        return { hits: [{ uri: "nafs://skills/deploy", title: "deploy", category: "skill", l0: "How to deploy" }], plan: [{ scope: "nafs://skills", why: "a task" }], ms: 12 };
      },
    });
    const user = userEvent.setup();
    render(<FsBrowser />);
    await screen.findByRole("button", { name: /^Memory/ });
    await user.type(screen.getByLabelText("Search files and memory"), "how do I deploy");
    await user.click(screen.getByRole("radio", { name: "Everywhere" }));
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByText(/1 result for/)).toBeInTheDocument();
    expect(body).toEqual({ query: "how do I deploy", k: 10 });
    expect(screen.getByText("How to deploy")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "deploy" }));
    expect(await screen.findByText("Deploy steps")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Edit/ })).toBeInTheDocument(); // a skill can be edited
  });

  it("shows the gateway's error with a retry", async () => {
    serve({
      "GET /v1/fs/ls": () => [502, { error: "The Semantic Duo gateway is unreachable" }],
      "GET /v1/fs/read": () => [502, { error: "The Semantic Duo gateway is unreachable" }],
    });
    render(<FsBrowser />);
    expect((await screen.findAllByText("The Semantic Duo gateway is unreachable")).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Try again/ }).length).toBeGreaterThan(0);
  });

  it("undoes a memory change", async () => {
    let undone = "";
    serve({
      "GET /v1/fs/ls": (u) => (lsOf(u) === "nafs://memory" ? MEM_LS : ROOT_LS),
      "GET /v1/fs/read": (u) => read(lsOf(u)!, "directory", "x"),
      "GET /v1/memory/diff": () => ({
        diff: [
          { id: "d 1", at: new Date().toISOString(), op: "update", uri: "nafs://memory/notes/a", title: "Port", reason: "you said so", undone: false },
          { id: "d2", at: new Date().toISOString(), op: "skip", uri: "nafs://memory/notes/b", title: "Same", reason: "nothing new", undone: false },
        ],
      }),
      "POST /v1/memory/diff/d%201/undo": () => {
        undone = "d 1";
        return { undone: true };
      },
    });
    const user = userEvent.setup();
    render(<FsBrowser />);
    await user.click(await screen.findByRole("button", { name: /^Memory/ }));
    expect(await screen.findByText("Changed")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Undo/ })).toHaveLength(1); // a skipped change has nothing to undo
    const reads = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith("/api/duo/gw/v1/fs/read?uri=nafs%3A%2F%2Fmemory&")).length;
    const before = reads();
    await user.click(screen.getByRole("button", { name: /^Undo/ }));
    await waitFor(() => expect(undone).toBe("d 1"));
    // the reader (and the folder) are read again, so what is shown matches the file put back
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
  });

  it("drops a search answer that arrives after another folder was opened", async () => {
    serve({
      "GET /v1/fs/ls": (u) => (lsOf(u) === "nafs://memory" ? MEM_LS : ROOT_LS),
      "GET /v1/fs/read": (u) => read(lsOf(u)!, "directory", lsOf(u) === "nafs://memory" ? "Memory overview" : "x"),
      "GET /v1/memory/diff": () => ({ diff: [] }),
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const routed = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input: string, init?: RequestInit) =>
      String(input).includes("/v1/fs/find") ? gate.then(() => json({ hits: [{ uri: "nafs://skills/deploy", title: "deploy", category: "skill" }] })) : routed(input, init)
    );
    const user = userEvent.setup();
    render(<FsBrowser />);
    await screen.findByRole("button", { name: /^Memory/ });
    await user.type(screen.getByLabelText("Search files and memory"), "deploy");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(screen.getByRole("button", { name: /^Memory/ }));
    expect(await screen.findByText("Memory overview")).toBeInTheDocument();
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/result for/)).not.toBeInTheDocument();
    expect(screen.getByText("Memory overview")).toBeInTheDocument();
  });
});
