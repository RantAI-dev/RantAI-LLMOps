import type { NextRequest } from "next/server";

import { getExperimentNotes, saveExperimentNotes } from "@/lib/notes-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read an experiment's markdown notes from Transformer Lab. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return Response.json({ notes: await getExperimentNotes(id) });
}

/** Save an experiment's markdown notes to Transformer Lab. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { notes?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const ok = await saveExperimentNotes(id, body.notes ?? "");
  return ok
    ? Response.json({ ok: true })
    : Response.json({ error: "Transformer Lab menolak menyimpan notes" }, { status: 502 });
}
