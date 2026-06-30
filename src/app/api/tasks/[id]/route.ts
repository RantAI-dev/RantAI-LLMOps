import type { NextRequest } from "next/server";

import { deleteJob } from "@/lib/tasks-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Delete a job record. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteJob(id);
  return ok
    ? Response.json({ ok: true })
    : Response.json({ error: "Transformer Lab menolak permintaan hapus" }, { status: 502 });
}
