import type { NextRequest } from "next/server";

import {
  deleteConversation,
  listConversations,
  saveConversation,
} from "@/lib/conversations-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** All saved chat conversations (newest first). */
export async function GET() {
  return Response.json({ conversations: await listConversations() });
}

/** Create/update one conversation (body = the chat session). */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !("id" in body)) {
    return Response.json({ error: "conversation with an `id` is required" }, { status: 400 });
  }
  const ok = await saveConversation(body);
  return ok ? Response.json({ ok: true }) : Response.json({ error: "save failed" }, { status: 502 });
}

/** Delete one conversation by `?id=`. */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "`id` query param is required" }, { status: 400 });
  const ok = await deleteConversation(id);
  return ok ? Response.json({ ok: true }) : Response.json({ error: "delete failed" }, { status: 502 });
}
