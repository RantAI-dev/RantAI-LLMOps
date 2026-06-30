import type { NextRequest } from "next/server";

import { stopJob } from "@/lib/tasks-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ask a running job to stop. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await stopJob(id);
  return ok
    ? Response.json({ ok: true })
    : Response.json({ error: "Transformer Lab menolak permintaan stop" }, { status: 502 });
}
