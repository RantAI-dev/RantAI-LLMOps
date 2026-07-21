import type { NextRequest } from "next/server";

import { hardStopAfterGrace, stopTrainingJob } from "@/lib/finetune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ask a running fine-tune job to stop. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ok = await stopTrainingJob(id);
  if (!ok) {
    return Response.json({ ok: false, error: "Transformer Lab menolak permintaan stop" }, { status: 502 });
  }
  // TL's stop is only SIGTERM, which a CUDA-busy training loop can ignore for a
  // long time. Escalate to SIGKILL after a grace period so Stop can't hang.
  // Fire-and-forget on the persistent Node server so the button returns at once.
  void hardStopAfterGrace(id);
  return Response.json({ ok: true });
}
