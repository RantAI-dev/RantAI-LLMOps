import type { NextRequest } from "next/server";

import { deleteTlExperiment } from "@/lib/tasks-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Delete an experiment. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteTlExperiment(id);
  return ok
    ? Response.json({ ok: true })
    : Response.json({ error: "Transformer Lab menolak permintaan hapus" }, { status: 502 });
}
