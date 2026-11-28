import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _relays, cleanUser, openRoomRelay, roomSocketUrl, sendRoomFrame } from "@/lib/duo-rooms";

const ROOM = "6f1c2c1e-8b1a-4c8e-9a51-0d6c5b1f2a3b";

describe("room relay", () => {
  beforeEach(() => {
    process.env.DUO_GATEWAY_URL = "https://gw.example:8443/";
    process.env.DUO_GATEWAY_TOKEN = "tok en";
  });
  afterEach(() => {
    delete process.env.DUO_GATEWAY_URL;
    delete process.env.DUO_GATEWAY_TOKEN;
    _relays.clear();
  });

  it("cleans display names the way the gateway accepts them", () => {
    expect(cleanUser("Ana <script>")).toBe("Ana script");
    expect(cleanUser("  Budi   Santoso  ")).toBe("Budi Santoso");
    expect(cleanUser("Assistant")).toBe("Guest");
    expect(cleanUser("")).toBe("Guest");
    expect(cleanUser("x".repeat(50))).toHaveLength(32);
  });

  it("builds the socket address with the token on the server only", () => {
    const u = new URL(roomSocketUrl(ROOM, "Ana"));
    expect(u.protocol).toBe("wss:");
    expect(u.pathname).toBe(`/ws/rooms/${ROOM}`);
    expect(u.searchParams.get("user")).toBe("Ana");
    expect(u.searchParams.get("token")).toBe("tok en");
  });

  it("refuses a bad room id and an unconfigured gateway", () => {
    expect(openRoomRelay(new Request("http://x/?user=a"), "../etc").status).toBe(400);
    delete process.env.DUO_GATEWAY_URL;
    expect(openRoomRelay(new Request("http://x/"), ROOM).status).toBe(503);
  });

  it("refuses frames for an unknown session or of an unknown type", async () => {
    const post = (b: unknown) => sendRoomFrame(new Request("http://x", { method: "POST", body: JSON.stringify(b) }), ROOM);
    expect((await post({ session: "nope", frame: { type: "user_message", payload: { content: "hi" } } })).status).toBe(410);
    const ws = { readyState: 1, send: () => undefined } as unknown as WebSocket;
    _relays.set("s1", { ws, room: ROOM, created: Date.now() });
    expect((await post({ session: "s1", frame: { type: "welcome" } })).status).toBe(400);
    expect((await post({ session: "s1", frame: { type: "user_message", payload: { content: " " } } })).status).toBe(400);
    expect((await post({ session: "s1", frame: { type: "user_message", payload: { content: "x".repeat(8001) } } })).status).toBe(400);
    expect((await sendRoomFrame(new Request("http://x", { method: "POST", body: JSON.stringify({ session: "s1", frame: { type: "ping" } }) }), "other-room-id-0000")).status).toBe(410);
  });
});
