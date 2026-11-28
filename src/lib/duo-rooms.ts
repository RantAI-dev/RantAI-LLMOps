/**
 * Server-only relay for Semantic Duo rooms. The gateway's live rooms are a WebSocket (`/ws/rooms/{id}?user=&token=`),
 * which a Next route handler cannot upgrade and which must not carry the gateway token to the browser. So the LLMOps
 * server holds the WebSocket, and the browser talks to it over two plain HTTP routes:
 *   GET  /api/duo/rooms/{id}/live?user=Name   → Server-Sent Events: `relay` {session} first, then one `frame` per
 *                                               gateway frame (RoomFrame), and `closed` {code, reason} at the end;
 *   POST /api/duo/rooms/{id}/live {session, frame} → one client frame (user_message, typing, ping) to the gateway.
 * One relay per open page. A relay ends when the page goes away (the SSE request is cancelled) or the gateway closes.
 * Needs the global WebSocket of Node 22 (the frontend image runs node:22).
 */

import { duoConfigured } from "@/lib/duo";

const baseUrl = () => (process.env.DUO_GATEWAY_URL ?? "").trim().replace(/\/+$/, "");
const token = () => (process.env.DUO_GATEWAY_TOKEN ?? "").trim();

type Relay = { ws: WebSocket; room: string; created: number };
const relays = new Map<string, Relay>();
/** Relays this server holds at most (each is one socket to the gateway; a room holds 64 members). */
export const MAX_RELAYS = 200;
const CLIENT_FRAMES = new Set(["user_message", "typing", "ping"]);
const ROOM_ID = /^[0-9a-fA-F-]{8,64}$/;

/** The gateway's display-name rule: letters, digits, space, `-`, `_`; at most 32 characters. */
export function cleanUser(raw: string | null | undefined): string {
  const u = (raw ?? "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
  return !u || /^(assistant|system)$/i.test(u) ? "Guest" : u;
}

/** The gateway WebSocket address for a room (http → ws, https → wss). */
export function roomSocketUrl(room: string, user: string): string {
  const u = new URL(`${baseUrl()}/ws/rooms/${encodeURIComponent(room)}`);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.searchParams.set("user", user);
  if (token()) u.searchParams.set("token", token());
  return u.toString();
}

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** GET: open a relay to the room and stream its frames as SSE. */
export function openRoomRelay(req: Request, room: string): Response {
  if (!duoConfigured()) return Response.json({ error: "Semantic Duo is not configured (DUO_GATEWAY_URL)" }, { status: 503 });
  if (!ROOM_ID.test(room)) return Response.json({ error: "Not a room id" }, { status: 400 });
  if (typeof WebSocket === "undefined") return Response.json({ error: "Live rooms need Node 22 on the LLMOps server" }, { status: 501 });
  if (relays.size >= MAX_RELAYS) return Response.json({ error: "Too many open rooms on this server; try again shortly" }, { status: 503 });
  const user = cleanUser(new URL(req.url).searchParams.get("user"));
  const session = crypto.randomUUID();
  const enc = new TextEncoder();
  let ws: WebSocket | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(sse(event, data)));
        } catch {
          /* the browser went away */
        }
      };
      const end = (code: number, reason: string) => {
        if (closed) return;
        send("closed", { code, reason });
        closed = true;
        relays.delete(session);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      try {
        ws = new WebSocket(roomSocketUrl(room, user));
      } catch (err) {
        send("closed", { code: 1011, reason: `Cannot open the room: ${err instanceof Error ? err.message : String(err)}` });
        closed = true;
        controller.close();
        return;
      }
      relays.set(session, { ws, room, created: Date.now() });
      send("relay", { session, user });
      ws.addEventListener("message", (e) => {
        if (typeof e.data !== "string") return;
        try {
          send("frame", JSON.parse(e.data));
        } catch {
          /* not JSON: not a RoomFrame */
        }
      });
      ws.addEventListener("close", (e) => end(e.code, e.reason || (e.code === 4004 ? "The room was deleted" : "The room connection closed")));
      ws.addEventListener("error", () => end(1011, "The Semantic Duo gateway refused or dropped the room connection"));
      req.signal.addEventListener("abort", () => {
        closed = true;
        relays.delete(session);
        try {
          ws?.close(1000, "left");
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      closed = true;
      relays.delete(session);
      try {
        ws?.close(1000, "left");
      } catch {
        /* already closed */
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no", connection: "keep-alive" },
  });
}

/** POST: one client frame to the room through an open relay. */
export async function sendRoomFrame(req: Request, room: string): Promise<Response> {
  let body: { session?: unknown; frame?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const relay = typeof body.session === "string" ? relays.get(body.session) : undefined;
  if (!relay || relay.room !== room) return Response.json({ error: "This room connection has ended; reconnect" }, { status: 410 });
  const frame = body.frame && typeof body.frame === "object" ? (body.frame as { type?: unknown; payload?: unknown }) : null;
  if (!frame || typeof frame.type !== "string" || !CLIENT_FRAMES.has(frame.type)) return Response.json({ error: "Unknown frame" }, { status: 400 });
  if (frame.type === "user_message") {
    const p = frame.payload && typeof frame.payload === "object" ? (frame.payload as { content?: unknown }) : {};
    if (typeof p.content !== "string" || !p.content.trim()) return Response.json({ error: "The message is empty" }, { status: 400 });
    if (p.content.length > 8000) return Response.json({ error: "A message can be at most 8,000 characters" }, { status: 400 });
  }
  if (relay.ws.readyState !== WebSocket.OPEN) return Response.json({ error: "The room is still connecting; try again" }, { status: 409 });
  relay.ws.send(JSON.stringify(frame));
  return Response.json({ ok: true });
}

/** For tests. */
export const _relays = relays;
