import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { duoProxy, duoTarget } from "@/lib/duo-proxy";

describe("duoTarget", () => {
  it("allows the listed routes with the right method", () => {
    expect(duoTarget("GET", ["v1", "kb"])).toBe("/v1/kb");
    expect(duoTarget("post", ["v1", "chat", "stream"])).toBe("/v1/chat/stream");
    expect(duoTarget("DELETE", ["v1", "kb", "notes", "documents", "d1"])).toBe("/v1/kb/notes/documents/d1");
    expect(duoTarget("GET", ["healthz"])).toBe("/healthz");
  });

  it("refuses unlisted routes and wrong methods", () => {
    expect(duoTarget("GET", ["metrics"])).toBeNull();
    expect(duoTarget("DELETE", ["v1", "kb"])).toBeNull();
    expect(duoTarget("GET", ["v1", "chat"])).toBeNull();
    expect(duoTarget("GET", ["ws", "rooms", "r1"])).toBeNull();
    expect(duoTarget("GET", [])).toBeNull();
  });

  it("refuses dot segments and encoded slashes", () => {
    expect(duoTarget("GET", ["v1", "kb", "..", "system"])).toBeNull();
    expect(duoTarget("GET", ["v1", "kb", "a/b"])).toBeNull();
    expect(duoTarget("GET", ["v1", "kb", ""])).toBeNull();
  });

  it("re-encodes segment text", () => {
    expect(duoTarget("GET", ["v1", "kb", "my notes"])).toBe("/v1/kb/my%20notes");
  });
});

describe("duoProxy", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    process.env.DUO_GATEWAY_URL = "http://gw:8080/";
    process.env.DUO_GATEWAY_TOKEN = "secret-token";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    delete process.env.DUO_GATEWAY_URL;
    delete process.env.DUO_GATEWAY_TOKEN;
    vi.unstubAllGlobals();
  });

  it("forwards with the server token, the query string and no cookies", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { status: 200, headers: { "content-type": "application/json", "set-cookie": "x=1" } }));
    const req = new Request("http://llmops/api/duo/gw/v1/memory?limit=5", { headers: { cookie: "session=abc", accept: "application/json" } });
    const res = await duoProxy(req, ["v1", "memory"]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: 1 });
    expect(res.headers.get("set-cookie")).toBeNull();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://gw:8080/v1/memory?limit=5");
    const h = init.headers as Headers;
    expect(h.get("authorization")).toBe("Bearer secret-token");
    expect(h.get("cookie")).toBeNull();
  });

  it("answers 404 for an unlisted route without calling the gateway", async () => {
    const res = await duoProxy(new Request("http://llmops/api/duo/gw/metrics"), ["metrics"]);
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 503 when the gateway is not configured", async () => {
    delete process.env.DUO_GATEWAY_URL;
    const res = await duoProxy(new Request("http://llmops/api/duo/gw/v1/kb"), ["v1", "kb"]);
    expect(res.status).toBe(503);
  });

  it("maps a refused token to 502 (a server problem), passes other errors through", async () => {
    fetchMock.mockResolvedValueOnce(new Response("no", { status: 401 }));
    expect((await duoProxy(new Request("http://llmops/x"), ["v1", "kb"])).status).toBe(502);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ message: "no such base" }), { status: 404 }));
    expect((await duoProxy(new Request("http://llmops/x"), ["v1", "kb", "nope"])).status).toBe(404);
  });

  it("answers 502 when the gateway is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await duoProxy(new Request("http://llmops/x"), ["v1", "kb"]);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("unreachable");
  });

  it("streams an SSE answer with buffering off", async () => {
    fetchMock.mockResolvedValue(new Response("event: done\ndata: {}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } }));
    const req = new Request("http://llmops/x", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    const res = await duoProxy(req, ["v1", "chat", "stream"]);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(await res.text()).toContain("event: done");
  });

  it("refuses a body over the limit", async () => {
    const req = new Request("http://llmops/x", { method: "POST", body: "x", headers: { "content-length": String(300 * 1024 * 1024) } });
    expect((await duoProxy(req, ["v1", "parse"])).status).toBe(413);
  });
});
