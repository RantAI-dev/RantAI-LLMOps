import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KbAdvanced } from "@/modules/duo/components/knowledge/kb-advanced";
import { checkFile, docState, highlightParts } from "@/modules/duo/components/knowledge/kb-api";
import { KbGraph } from "@/modules/duo/components/knowledge/kb-graph";

type Handler = (body: unknown) => unknown;
let routes: Record<string, Handler | { status: number; body: unknown }> = {};
const calls: Array<{ method: string; path: string; body: unknown }> = [];
const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  const url = new URL(input, "http://localhost");
  const method = (init?.method ?? "GET").toUpperCase();
  const path = url.pathname.replace(/^\/api\/duo\/gw/, "");
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  calls.push({ method, path: path + url.search, body });
  const h = routes[`${method} ${path}`];
  if (!h) return new Response(JSON.stringify({ message: `no route ${method} ${path}` }), { status: 404 });
  if (typeof h === "function") return new Response(JSON.stringify(h(body) ?? {}), { status: 200 });
  return new Response(JSON.stringify(h.body), { status: h.status });
});
const called = (method: string, prefix: string) => calls.filter((c) => c.method === method && c.path.startsWith(prefix));

beforeEach(() => {
  calls.length = 0;
  routes = {};
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockClear();
});

const GRAPH = {
  enabled: true,
  source: "model",
  stats: { entities: 3, relations: 2, communities: 1 },
  progress: { passages_read: 30, passages: 30, building: false },
  nodes: [
    { id: "e1", name: "Gate", type: "method", mentions: 12, community: 0 },
    { id: "e2", name: "System 2", type: "model", mentions: 8, community: 0 },
    { id: "e3", name: "Qwen3", type: "model", mentions: 3, community: 0 },
  ],
  edges: [
    { source: "e1", target: "e2", predicate: "escalates to", weight: 3 },
    { source: "e2", target: "e3", predicate: "is based on", weight: 1 },
  ],
};

describe("KbGraph", () => {
  it("builds an empty graph only after a second click", async () => {
    routes["GET /v1/kb/kb1/graph"] = () => ({ ...GRAPH, nodes: [], edges: [], stats: { entities: 0 }, progress: { passages_read: 0, passages: 40, building: false } });
    routes["POST /v1/kb/kb1/graph/build"] = () => ({ queued: 2 });
    const onBuild = vi.fn();
    render(<KbGraph kb="kb1" onOpen={vi.fn()} onBuildStarted={onBuild} />);
    const user = userEvent.setup();
    expect(await screen.findByText(/No graph yet/)).toBeInTheDocument();
    expect(screen.getByText(/40 passages, about 10 minutes/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /build the graph/i }));
    expect(called("POST", "/v1/kb/kb1/graph/build")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: /click again to start/i }));
    await waitFor(() => expect(called("POST", "/v1/kb/kb1/graph/build")).toHaveLength(1));
    expect(onBuild).toHaveBeenCalled();
  });

  it("shows building progress", async () => {
    routes["GET /v1/kb/kb1/graph"] = () => ({ ...GRAPH, progress: { passages_read: 10, passages: 40, building: true } });
    render(<KbGraph kb="kb1" onOpen={vi.fn()} onBuildStarted={vi.fn()} />);
    expect(await screen.findByText(/Reading 10 of 40 passages/)).toBeInTheDocument();
    expect(screen.getByRole("meter", { name: "Graph building progress" })).toHaveAttribute("aria-valuenow", "0.25");
    expect(screen.queryByRole("button", { name: /build the graph/i })).not.toBeInTheDocument();
  });

  it("lists the most mentioned things and relations, and shows one thing's facts with the passage behind them", async () => {
    routes["GET /v1/kb/kb1/graph"] = () => GRAPH;
    routes["GET /v1/kb/kb1/graph/entities/e1"] = () => ({
      facts: [{ id: "f1", source_id: "e1", source: "Gate", predicate: "escalates to", target_id: "e2", target: "System 2", weight: 3, quote: "the gate hands hard questions to System 2", evidence: ["c9"] }],
      passages: [{ chunk_id: "c9", doc_id: "d1", doc_title: "Gate design", ord: 4, page: 3, text: "When unsure, the gate hands hard questions to System 2.", score: 0 }],
    });
    const onOpen = vi.fn();
    render(<KbGraph kb="kb1" onOpen={onOpen} onBuildStarted={vi.fn()} />);
    const user = userEvent.setup();
    expect(await screen.findByText("Showing 3 of 3 things: the most mentioned")).toBeInTheDocument();
    expect(screen.getByText("Relations shown")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Gate, method/ }));
    expect(await screen.findByText(/“the gate hands hard questions to System 2”/)).toBeInTheDocument();
    await user.click(screen.getByText(/Where it says so: Gate design, page 3/));
    await user.click(screen.getByRole("button", { name: "Open in the document" }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ docId: "d1", chunkId: "c9", ord: 4 }));
  });

  it("filters by kind and finds a thing by name", async () => {
    routes["GET /v1/kb/kb1/graph"] = () => GRAPH;
    routes["GET /v1/kb/kb1/graph/entities"] = () => ({ entities: [{ id: "e3", name: "Qwen3", type: "model" }] });
    render(<KbGraph kb="kb1" onOpen={vi.fn()} onBuildStarted={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^model 2/ }));
    expect(screen.queryByRole("button", { name: /^Gate, method/ })).not.toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Find a thing in the graph" }), "qwen");
    await waitFor(() => expect(called("GET", "/v1/kb/kb1/graph/entities?q=qwen")).toHaveLength(1));
    expect(await screen.findByRole("button", { name: /^Qwen3 model$/ })).toBeInTheDocument();
  });

  it("asks for the text graph around a thing on a base that has only the text graph, and can always go back", async () => {
    const TEXT = { ...GRAPH, source: "text", stats: { entities: 0 }, edges: [{ source: "e1", target: "e2", predicate: "", weight: 2 }] };
    routes["GET /v1/kb/kb1/graph"] = () => {
      const q = new URL(calls[calls.length - 1].path, "http://x").searchParams;
      if (!q.get("entity")) return TEXT;
      // like the gateway: without source=text the view around a thing comes from the (empty) model-built graph
      return q.get("source") === "text" ? { ...TEXT, nodes: TEXT.nodes.slice(0, 2) } : { ...GRAPH, nodes: [], edges: [] };
    };
    render(<KbGraph kb="kb1" onOpen={vi.fn()} onBuildStarted={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^Gate, method/ }));
    await user.click(screen.getByRole("button", { name: "Show what is around it" }));
    expect(await screen.findByText(/Gate and what is around it/)).toBeInTheDocument();
    expect(called("GET", "/v1/kb/kb1/graph?").at(-1)!.path).toContain("entity=e1&source=text");
    await user.click(screen.getByRole("button", { name: "Show the most mentioned" }));
    expect(await screen.findByText(/: the most mentioned/)).toBeInTheDocument();
  });

  it("keeps the way back when nothing is around the chosen thing", async () => {
    routes["GET /v1/kb/kb1/graph"] = () => (new URL(calls[calls.length - 1].path, "http://x").searchParams.get("entity") ? { ...GRAPH, nodes: [], edges: [] } : GRAPH);
    render(<KbGraph kb="kb1" onOpen={vi.fn()} onBuildStarted={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^Qwen3, model/ }));
    await user.click(screen.getByRole("button", { name: "Show what is around it" }));
    expect(await screen.findByText("Nothing is recorded around this thing.")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Find a thing in the graph" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show the most mentioned" }));
    expect(await screen.findByText("Showing 3 of 3 things: the most mentioned")).toBeInTheDocument();
  });

  it("says when the graph is turned off", async () => {
    routes["GET /v1/kb/kb1/graph"] = () => ({ ...GRAPH, enabled: false, nodes: [], edges: [], stats: {}, progress: { passages: 5, passages_read: 0 } });
    render(<KbGraph kb="kb1" onOpen={vi.fn()} onBuildStarted={vi.fn()} />);
    expect(await screen.findByText("Building the graph is turned off on this server.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /build/i })).not.toBeInTheDocument();
  });
});

describe("KbAdvanced", () => {
  const status = { enabled: true, reachable: true, version: "2.1.0", embedder: { model: "bge-m3", reachable: true }, limits: { max_upload_mb: 50 } };
  const base = { id: "kb1", name: "Project papers" };
  beforeEach(() => {
    routes["GET /v1/kb/kb1/ontology"] = () => ({ types: [{ name: "method", definition: "a technique" }, { name: "concept", definition: "anything else" }], default: true });
    routes["GET /v1/kb/kb1/memory/runs"] = () => ({ runs: [], active: null, trainer: false });
  });

  it("edits and saves the graph types, and refuses two with one name", async () => {
    routes["PUT /v1/kb/kb1/ontology"] = (b) => ({ ...(b as object), default: false });
    render(<KbAdvanced kb="kb1" base={base} status={status} />);
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Type 1 name");
    await user.clear(name);
    await user.type(name, "concept");
    expect(screen.getByRole("alert")).toHaveTextContent("Two types are called “concept”");
    expect(screen.getByRole("button", { name: "Save types" })).toBeDisabled();
    await user.clear(name);
    await user.type(name, "algorithm");
    await user.click(screen.getByRole("button", { name: "Save types" }));
    await waitFor(() =>
      expect(called("PUT", "/v1/kb/kb1/ontology")[0]?.body).toEqual({
        types: [
          { name: "algorithm", definition: "a technique" },
          { name: "concept", definition: "anything else" },
        ],
      })
    );
    expect(await screen.findByText("Custom types")).toBeInTheDocument();
  });

  it("tells the page after a rebuild or re-index, and offers no rebuild while the graph is being built", async () => {
    routes["POST /v1/kb/kb1/graph/build"] = () => ({ queued: 2 });
    routes["POST /v1/kb/kb1/reindex"] = () => ({ queued: 3 });
    const onRebuilt = vi.fn();
    const onReindexed = vi.fn();
    const { rerender } = render(<KbAdvanced kb="kb1" base={base} status={status} onRebuilt={onRebuilt} onReindexed={onReindexed} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Rebuild the graph from scratch" }));
    await user.click(screen.getByRole("button", { name: /click again: reads every passage again/i }));
    await waitFor(() => expect(onRebuilt).toHaveBeenCalledWith(2));
    await user.click(screen.getByRole("button", { name: "Index every passage for meaning again" }));
    await user.click(screen.getByRole("button", { name: /click again: every passage is indexed again/i }));
    await waitFor(() => expect(onReindexed).toHaveBeenCalledWith(3));
    rerender(<KbAdvanced kb="kb1" base={base} status={status} graphBuilding onRebuilt={onRebuilt} onReindexed={onReindexed} />);
    expect(screen.getByRole("button", { name: "The graph is being built…" })).toBeDisabled();
  });

  it("says when the trainer is not installed", async () => {
    render(<KbAdvanced kb="kb1" base={base} status={status} />);
    expect(await screen.findByText("The trainer is not installed on this server.")).toBeInTheDocument();
  });

  it("stops a running training and activates a finished one", async () => {
    routes["GET /v1/kb/kb1/memory/runs"] = () => ({
      trainer: true,
      active: null,
      runs: [
        { id: "r2", kind: "train", state: "training", created_at: "2026-11-28T01:00:00Z", progress: { step: 5, steps: 20, loss: [[1, 2.0], [5, 1.2]] } },
        { id: "r1", kind: "train", state: "done", has_checkpoint: true, created_at: "2026-11-27T01:00:00Z", progress: {} },
      ],
    });
    routes["POST /v1/kb/kb1/memory/runs/r2/stop"] = () => ({});
    routes["POST /v1/kb/kb1/memory/runs/r1/activate"] = () => ({ active: "x" });
    render(<KbAdvanced kb="kb1" base={base} status={status} />);
    const user = userEvent.setup();
    expect(await screen.findByText(/step 5 of 20/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /train a module/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Stop" }));
    await user.click(screen.getByRole("button", { name: "Use this module" }));
    await waitFor(() => {
      expect(called("POST", "/v1/kb/kb1/memory/runs/r2/stop")).toHaveLength(1);
      expect(called("POST", "/v1/kb/kb1/memory/runs/r1/activate")).toHaveLength(1);
    });
  });

  it("compiles the base to a Markdown download", async () => {
    routes["POST /v1/compile"] = () => ({ files: [{ path: "index.md", content: "# Papers" }, { path: "d1.md", content: "# Gate" }] });
    const createObjectURL = vi.fn(() => "blob:x");
    const u = URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
    const keep = { create: u.createObjectURL, revoke: u.revokeObjectURL };
    u.createObjectURL = createObjectURL;
    u.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<KbAdvanced kb="kb1" base={base} status={status} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Wiki" }));
    expect(await screen.findByText("2 pages compiled and downloaded as Project-papers-wiki.md.")).toBeInTheDocument();
    expect(called("POST", "/v1/compile")[0]?.body).toEqual({ from: "nafs://kb/kb1", to: "wiki" });
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    click.mockRestore();
    u.createObjectURL = keep.create;
    u.revokeObjectURL = keep.revoke;
  });
});

describe("kb-api helpers", () => {
  it("marks the query's words, case-insensitively, and skips function words", () => {
    expect(highlightParts("The Gate and the gate", "the gate")).toEqual([
      { t: "The ", hit: false },
      { t: "Gate", hit: true },
      { t: " and the ", hit: false },
      { t: "gate", hit: true },
    ]);
  });

  it("describes document states in plain words", () => {
    expect(docState({ id: "a", status: "embedding", n_chunks: 10, n_embedded: 5 }, true)).toEqual({ label: "Indexing 50%", tone: "warn", busy: true });
    expect(docState({ id: "a", status: "ready", n_chunks: 10, n_embedded: 5 }, true).label).toBe("Words only");
    expect(docState({ id: "a", status: "ready", n_chunks: 10, n_embedded: 5 }, false).label).toBe("Ready");
    expect(docState({ id: "a" }, true).busy).toBe(true);
  });

  it("checks type, size and emptiness of a file", () => {
    expect(checkFile(new File(["a"], "x.exe"), 50)).toMatch(/cannot be read/);
    expect(checkFile(new File([], "x.pdf"), 50)).toBe("This file is empty.");
    expect(checkFile(new File(["a"], "X.PDF"), 50)).toBeNull();
  });
});
