import type { NextRequest } from "next/server";

import { stopJob } from "@/lib/tasks-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ask a running eval job to stop. An eval is a Transformer Lab job, so this
 *  reuses the generic job-stop (resolves the job's experiment, then `/stop`). */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await stopJob(id);
  return ok
    ? Response.json({ ok: true })
    : Response.json({ error: "Transformer Lab rejected the stop request" }, { status: 502 });
}
