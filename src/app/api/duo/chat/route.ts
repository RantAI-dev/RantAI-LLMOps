import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { duoChat, duoConfigured, DuoError, parseDuoRequest } from "@/lib/duo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A System 2 answer with a judge can take minutes.
export const maxDuration = 900;

/** Whether the Duo gateway is configured, for the page's empty state. Never reveals the address or token. */
export async function GET(req: NextRequest) {
  const denied = await guardApi(req);
  if (denied) return denied;
  return Response.json({ configured: duoConfigured() });
}

/** One Duo turn: `{ messages, mode?: "auto" | "fast" | "slow", lambda? }` → the answer and its trace. */
export async function POST(req: NextRequest) {
  const denied = await guardApi(req);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    return Response.json(await duoChat(parseDuoRequest(body)));
  } catch (err) {
    const status = err instanceof DuoError ? err.status : 502;
    return Response.json({ error: err instanceof Error ? err.message : "Duo request failed" }, { status });
  }
}
