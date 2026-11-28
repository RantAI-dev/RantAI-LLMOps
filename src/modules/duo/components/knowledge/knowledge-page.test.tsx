import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KnowledgePage } from "@/modules/duo/components/knowledge/knowledge-page";

// ---------- a small gateway behind the mocked fetch ----------

type Handler = (body: unknown, url: URL) => unknown | Promise<unknown>;
type Reply = { status: number; body: unknown };
let routes: Record<string, Handler | Reply> = {};
const calls: Array<{ method: string; path: string; body: unknown }> = [];

const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  const url = new URL(input, "http://localhost");
  const method = (init?.method ?? "GET").toUpperCase();
  const path = url.pathname.replace(/^\/api\/duo\/gw/, "");
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  calls.push({ method, path: path + url.search, body });
  const h = routes[`${method} ${path}`];
  if (!h) return new Response(JSON.stringify({ message: `no route ${method} ${path}` }), { status: 404 });
  if (typeof h === "function") return new Response(JSON.stringify((await h(body, url)) ?? {}), { status: 200 });
  return new Response(JSON.stringify(h.body), { status: h.status });
});
const called = (method: string, prefix: string) => calls.filter((c) => c.method === method && c.path.startsWith(prefix));

// XMLHttpRequest stand-in for uploads (they report progress, so they do not go through fetch).
let xhrReply: { status: number; body: unknown } = { status: 202, body: { documents: [], refused: [] } };
const sent: string[] = [];
class FakeXHR {
  status = 0;
  responseText = "";
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  url = "";
  open(_m: string, url: string) {
    this.url = url;
  }
  setRequestHeader() {}
  abort() {
    this.onabort?.();
  }
  send(fd: FormData) {
    sent.push(`${this.url} ${(fd.get("file") as File | null)?.name}`);
    setTimeout(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
      this.status = xhrReply.status;
      this.responseText = JSON.stringify(xhrReply.body);
      this.onload?.();
    }, 0);
  }
}

const STATUS_OK = {
  enabled: true,
  reachable: true,
  version: "2.1.0",
  embedder: { model: "bge-m3", reachable: true },
  limits: { max_upload_mb: 1 },
  queue: { pending: 0, running: 0 },
};
const BASE = { id: "papers", name: "Project papers", description: "Our research", documents: 2, chunks: 40, chars: 12000 };
const DOC_READY = { id: "d1", title: "Gate design", filename: "gate.pdf", kind: "pdf", bytes: 20480, status: "ready", pages: 4, n_chunks: 30, n_embedded: 30, created_at: "2026-11-27T10:00:00Z" };
const DOC_FAILED = { id: "d2", title: "Broken", filename: "broken.docx", kind: "docx", bytes: 100, status: "failed", error: "the file could not be parsed", n_chunks: 0 };

function gateway(over: Record<string, Handler | Reply> = {}) {
  routes = {
    "GET /v1/kb/status": () => STATUS_OK,
    "GET /v1/kb": () => ({ bases: [BASE] }),
    "GET /v1/kb/papers/documents": () => ({ documents: [DOC_READY, DOC_FAILED] }),
    ...over,
  };
}

beforeEach(() => {
  calls.length = 0;
  sent.length = 0;
  xhrReply = { status: 202, body: { documents: [], refused: [] } };
  window.localStorage.clear();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockClear();
});

// ---------- the store's own states ----------

describe("KnowledgePage: the knowledge store", () => {
  it("explains that Knowledge is turned off, with no controls for bases", async () => {
    gateway({ "GET /v1/kb/status": () => ({ enabled: false, reachable: false }) });
    render(<KnowledgePage />);
    expect(await screen.findByText("Knowledge is turned off on this server")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^new$/i })).not.toBeInTheDocument();
    expect(called("GET", "/v1/kb").filter((c) => c.path === "/v1/kb")).toHaveLength(0);
  });

  it("says the store is not running and shows its error", async () => {
    gateway({ "GET /v1/kb/status": () => ({ enabled: true, reachable: false, error: "connection refused" }) });
    render(<KnowledgePage />);
    expect(await screen.findByText("The knowledge store is not running")).toBeInTheDocument();
    expect(screen.getByText("Connection refused.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows the gateway error when the status cannot be loaded", async () => {
    gateway({ "GET /v1/kb/status": { status: 502, body: { error: "The Semantic Duo gateway is unreachable: ECONNREFUSED" } } });
    render(<KnowledgePage />);
    expect(await screen.findByText(/Could not load Knowledge/)).toBeInTheDocument();
    expect(screen.getByText(/ECONNREFUSED/)).toBeInTheDocument();
  });
});

// ---------- bases ----------

describe("KnowledgePage: bases", () => {
  it("invites to create the first base, and creates it", async () => {
    let bases: unknown[] = [];
    gateway({
      "GET /v1/kb": () => ({ bases }),
      "POST /v1/kb": (b) => {
        const nb = { id: "new1", name: (b as { name: string }).name, description: "", documents: 0, chunks: 0, chars: 0 };
        bases = [nb];
        return nb;
      },
      "GET /v1/kb/new1/documents": () => ({ documents: [] }),
    });
    render(<KnowledgePage />);
    const user = userEvent.setup();
    expect(await screen.findByText("Bring your documents")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /new knowledge base/i }));
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Give it a name.");
    await user.type(screen.getByLabelText("Name of the new knowledge base"), "  Contracts   2026 ");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(called("POST", "/v1/kb")[0]?.body).toEqual({ name: "Contracts 2026", description: "" }));
    expect(await screen.findByRole("heading", { name: "Contracts 2026" })).toBeInTheDocument();
    expect(await screen.findByText(/No documents yet/)).toBeInTheDocument();
  });

  it("opens the base asked for in the address, links Chat to it, and deletes it only on the second click", async () => {
    window.history.pushState({}, "", "/duo/knowledge?kb=other");
    const OTHER = { id: "other", name: "Other base", documents: 0, chunks: 0 };
    let bases: unknown[] = [BASE, OTHER];
    gateway({
      "GET /v1/kb": () => ({ bases }),
      "GET /v1/kb/other/documents": () => ({ documents: [] }),
      "DELETE /v1/kb/other": () => {
        bases = [BASE];
        return { deleted: true };
      },
    });
    render(<KnowledgePage />);
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Other base" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /ask about this base/i })).toHaveAttribute("href", "/duo?kb=other");
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(called("DELETE", "/v1/kb/other")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: /click again to delete it all/i }));
    await waitFor(() => expect(called("DELETE", "/v1/kb/other")).toHaveLength(1));
    expect(await screen.findByRole("heading", { name: "Project papers" })).toBeInTheDocument();
    window.history.pushState({}, "", "/");
  });

  it("does not show or load a deleted base again while the list catches up", async () => {
    const OTHER = { id: "other", name: "Other base", documents: 0, chunks: 0 };
    gateway({
      // the list is stale on purpose: it still names the deleted base
      "GET /v1/kb": () => ({ bases: [OTHER, BASE] }),
      "GET /v1/kb/other/documents": () => ({ documents: [] }),
      "DELETE /v1/kb/other": () => ({ deleted: true }),
    });
    render(<KnowledgePage />);
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Other base" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: /click again to delete it all/i }));
    expect(await screen.findByRole("heading", { name: "Project papers" })).toBeInTheDocument();
    const loads = called("GET", "/v1/kb/other/documents").length;
    await waitFor(() => expect(called("GET", "/v1/kb").filter((c) => c.path === "/v1/kb").length).toBeGreaterThan(1));
    expect(screen.queryByRole("heading", { name: "Other base" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Other base/ })).not.toBeInTheDocument();
    expect(called("GET", "/v1/kb/other/documents")).toHaveLength(loads);
  });

  it("renames a base", async () => {
    gateway({ "PATCH /v1/kb/papers": () => ({ ...BASE, name: "Papers" }) });
    render(<KnowledgePage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /rename/i }));
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Papers");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(called("PATCH", "/v1/kb/papers")[0]?.body).toEqual({ name: "Papers", description: "Our research" }));
  });
});

// ---------- documents ----------

describe("KnowledgePage: documents", () => {
  it("lists documents with their state and the reason one failed", async () => {
    gateway();
    render(<KnowledgePage />);
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Gate design")).toBeInTheDocument();
    expect(within(table).getByText("Ready")).toBeInTheDocument();
    expect(within(table).getByText("Failed")).toBeInTheDocument();
    expect(within(table).getByText("The file could not be parsed.")).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Passages of Broken" })).toBeDisabled();
  });

  it("deletes a document only after a second click", async () => {
    gateway({ "DELETE /v1/kb/papers/documents/d1": () => ({ deleted: true }) });
    render(<KnowledgePage />);
    const user = userEvent.setup();
    const del = await screen.findByRole("button", { name: "Delete Gate design" });
    await user.click(del);
    expect(called("DELETE", "/v1/kb/papers/documents/d1")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Delete?" }));
    await waitFor(() => expect(called("DELETE", "/v1/kb/papers/documents/d1")).toHaveLength(1));
  });

  it("opens a document's passages with heading and page", async () => {
    gateway({
      "GET /v1/kb/papers/documents/d1/chunks": () => ({ chunks: [{ id: "c1", ord: 0, text: "## Intro\nThe gate decides.", heading: "Intro", page: 2 }], total: 1, offset: 0 }),
    });
    render(<KnowledgePage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Passages of Gate design" }));
    expect(await screen.findByText(/The gate decides\./)).toBeInTheDocument();
    expect(screen.getByText(/#1 · Intro · page 2/)).toBeInTheDocument();
  });

  it("refuses a file type it cannot read before sending anything", async () => {
    gateway();
    render(<KnowledgePage />);
    const user = userEvent.setup({ applyAccept: false });
    const input = await screen.findByTestId("kb-file-input");
    await user.upload(input, new File(["x"], "photo.png", { type: "image/png" }));
    expect(await screen.findByText(/This type of file cannot be read/)).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  it("refuses a file over the gateway's limit before sending it", async () => {
    gateway();
    render(<KnowledgePage />);
    const user = userEvent.setup();
    await user.upload(await screen.findByTestId("kb-file-input"), new File([new Uint8Array(2 * 1024 * 1024)], "big.pdf", { type: "application/pdf" }));
    expect(await screen.findByText(/the limit is 1 MB/)).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  it("uploads a file and shows the reason the gateway refused it", async () => {
    gateway();
    xhrReply = { status: 422, body: { documents: [], refused: [{ filename: "notes.md", reason: "the file has no text" }] } };
    render(<KnowledgePage />);
    const user = userEvent.setup();
    await user.upload(await screen.findByTestId("kb-file-input"), new File(["# hi"], "notes.md", { type: "text/markdown" }));
    expect(await screen.findByText("The file has no text.")).toBeInTheDocument();
    expect(sent).toEqual(["/api/duo/gw/v1/kb/papers/documents notes.md"]);
    expect(screen.queryByRole("button", { name: /try notes.md again/i })).not.toBeInTheDocument();
  });

  it("shows an upload error and offers to try again", async () => {
    gateway();
    xhrReply = { status: 429, body: { code: "busy", message: "other uploads are being received; try again in a moment" } };
    render(<KnowledgePage />);
    const user = userEvent.setup();
    await user.upload(await screen.findByTestId("kb-file-input"), new File(["hello"], "a.txt", { type: "text/plain" }));
    expect(await screen.findByText(/other uploads are being received/)).toBeInTheDocument();
    xhrReply = { status: 202, body: { documents: [{ id: "d9", title: "a", status: "queued" }], refused: [] } };
    await user.click(screen.getByRole("button", { name: "Try a.txt again" }));
    expect(await screen.findByText(/Added\. It is being read now/)).toBeInTheDocument();
    expect(sent).toHaveLength(2);
  });

  it("keeps refreshing while a document is being read", async () => {
    let n = 0;
    gateway({
      "GET /v1/kb/papers/documents": () => {
        n++;
        return { documents: [{ ...DOC_READY, status: n < 2 ? "parsing" : "ready" }] };
      },
    });
    render(<KnowledgePage />);
    expect(await screen.findByText("Reading")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Ready")).toBeInTheDocument(), { timeout: 4000 });
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it("offers to index documents that can only be found by words", async () => {
    gateway({
      "GET /v1/kb/papers/documents": () => ({ documents: [{ ...DOC_READY, n_embedded: 10 }] }),
      "POST /v1/kb/papers/reindex": () => ({ queued: 1 }),
    });
    render(<KnowledgePage />);
    const user = userEvent.setup();
    expect(await screen.findByText("1 document can only be searched by words so far.")).toBeInTheDocument();
    expect(screen.getByText("Words only")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Index for meaning" }));
    await waitFor(() => expect(called("POST", "/v1/kb/papers/reindex")).toHaveLength(1));
  });

  it("does not keep refreshing when indexing queued nothing", async () => {
    gateway({
      "GET /v1/kb/papers/documents": () => ({ documents: [{ ...DOC_READY, n_embedded: 10 }] }),
      "POST /v1/kb/papers/reindex": () => ({ queued: 0 }),
    });
    render(<KnowledgePage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Index for meaning" }));
    await waitFor(() => expect(called("POST", "/v1/kb/papers/reindex")).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 100));
    const loads = called("GET", "/v1/kb/papers/documents").length;
    await new Promise((r) => setTimeout(r, 2300));
    expect(called("GET", "/v1/kb/papers/documents")).toHaveLength(loads);
  });
});

// ---------- search ----------

describe("KnowledgePage: search", () => {
  it("searches by the chosen mode and shows passage, document, page and score", async () => {
    gateway({
      "POST /v1/kb/papers/search": () => ({
        mode: "lexical",
        took_ms: 12,
        results: [{ chunk_id: "c1", doc_id: "d1", doc_title: "Gate design", ord: 3, heading: "Routing", page: 2, text: "The gate escalates hard questions.", score: 1.234, lexical_score: 4.2 }],
      }),
    });
    render(<KnowledgePage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Search" }));
    await user.click(screen.getByRole("radio", { name: "Words" }));
    await user.type(screen.getByRole("searchbox", { name: "Search this knowledge base" }), "gate{Enter}");
    await waitFor(() => expect(called("POST", "/v1/kb/papers/search").at(-1)?.body).toEqual({ query: "gate", k: 8, mode: "lexical" }));
    expect(await screen.findByText(/1 passage by words/)).toBeInTheDocument();
    expect(screen.getByText(/› Routing/)).toBeInTheDocument();
    expect(screen.getByText(/page 2/)).toBeInTheDocument();
    expect(screen.getByText("score 1.234")).toBeInTheDocument();
    expect(screen.getByText("gate", { selector: "mark" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ask about this" })).toHaveAttribute("href", "/duo?kb=papers");
  });

  it("says when nothing matches and when the search fell back to words", async () => {
    gateway({ "POST /v1/kb/papers/search": () => ({ mode: "lexical", results: [], fallback: "the embedder is not answering" }) });
    render(<KnowledgePage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Search" }));
    await user.type(screen.getByRole("searchbox", { name: "Search this knowledge base" }), "nothing{Enter}");
    expect(await screen.findByText(/No passage matches/)).toBeInTheDocument();
    expect(screen.getByText(/The embedder is not answering\./)).toBeInTheDocument();
  });
});
