import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { openRoomRelay, sendRoomFrame } from "@/lib/duo-rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A room page can stay open for a long time; the relay ends when the page closes.
export const maxDuration = 3600;

type Ctx = { params: Promise<{ id: string }> };

/** Live room frames as Server-Sent Events (see src/lib/duo-rooms.ts). */
export async function GET(req: NextRequest, { params }: Ctx) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { id } = await params;
  return openRoomRelay(req, id);
}

/** One client frame (user_message, typing, ping) to the room. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { id } = await params;
  return sendRoomFrame(req, id);
}
