import { afterEach, describe, expect, it, vi } from "vitest";

import { errorText, gw, GwError, gwStream, parseSse } from "@/modules/duo/lib/gw";

describe("parseSse", () => {
  it("splits complete events and keeps the rest", () => {
    const { events, rest } = parseSse('event: token\ndata: {"data":{"text":"a"}}\n\nevent: done\ndata: {"da');
    expect(events).toEqual([{ event: "token", data: { data: { text: "a" } } }]);
    expect(rest).toBe('event: done\ndata: {"da');
  });
  it("handles CRLF, comments and multi-line data", () => {
    const { events } = parseSse(": keep-alive\r\n\r\nevent: x\r\ndata: line1\r\ndata: line2\r\n\r\n");
    expect(events).toEqual([{ event: "x", data: "line1\nline2" }]);
  });
});

describe("errorText", () => {
  it("prefers the gateway's message", () => {
    expect(errorText(400, { message: "bad kb" })).toBe("bad kb");
    expect(errorText(400, { error: { message: "nested" } })).toBe("nested");
    expect(errorText(503, null)).toMatch(/not available/);
  });
});

describe("gw", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("throws GwError with the status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "no such base" }), { status: 404 })));
    await expect(gw("/v1/kb/x")).rejects.toMatchObject({ status: 404, message: "no such base" });
  });
  it("streams events across chunk boundaries", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode('event: token\ndata: {"data":{"te'));
        c.enqueue(enc.encode('xt":"hi"}}\n\nevent: done\ndata: {"data":{}}'));
        c.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } })));
    const seen: string[] = [];
    await gwStream("/v1/chat/stream", {}, (e) => seen.push(e.event));
    expect(seen).toEqual(["token", "done"]);
  });
  it("fails a stream with the gateway's error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "rate limited" }), { status: 429 })));
    await expect(gwStream("/v1/chat/stream", {}, () => undefined)).rejects.toBeInstanceOf(GwError);
  });
});
