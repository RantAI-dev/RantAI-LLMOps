import type { NextRequest } from "next/server";

import { createNote, listNotes } from "@/lib/notes-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List all notes (id + display title). */
export async function GET() {
  return Response.json({ notes: await listNotes() });
}

/** Create a note from a title. */
export async function POST(req: NextRequest) {
  let body: { title?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const title = body.title?.trim();
  if (!title) return Response.json({ error: "`title` is required" }, { status: 400 });
  try {
    const created = await createNote(title);
    if (!created) {
      return Response.json({ error: "Judul harus mengandung huruf/angka" }, { status: 400 });
    }
    return Response.json({ ok: true, note: created.note, existed: created.existed });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Gagal membuat catatan" },
      { status: 502 }
    );
  }
}
