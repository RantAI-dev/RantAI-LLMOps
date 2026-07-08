import type { NextRequest } from "next/server";

import { deleteNote, getNoteContent, saveNoteContent } from "@/lib/notes-server";
import { NOTE_PREFIX } from "@/lib/tl-constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notFound = () => Response.json({ error: "Catatan tidak ditemukan" }, { status: 404 });

/** Read a note's markdown content. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Notes API is confined to the notes namespace — never a real job experiment.
  if (!id.startsWith(NOTE_PREFIX)) return notFound();
  return Response.json({ content: await getNoteContent(id) });
}

/** Save a note's markdown content. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id.startsWith(NOTE_PREFIX)) return notFound();
  let body: { content?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const ok = await saveNoteContent(id, body.content ?? "");
  return ok
    ? Response.json({ ok: true })
    : Response.json({ error: "Transformer Lab menolak menyimpan catatan" }, { status: 502 });
}

/** Delete a note. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id.startsWith(NOTE_PREFIX)) return notFound();
  const ok = await deleteNote(id);
  return ok
    ? Response.json({ ok: true })
    : Response.json({ error: "Gagal menghapus catatan" }, { status: 502 });
}
