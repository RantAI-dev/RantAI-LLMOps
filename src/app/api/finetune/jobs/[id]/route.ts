import type { NextRequest } from "next/server";

import { deleteTrainingJob, fetchTrainingJob } from "@/lib/finetune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Single fine-tune job status (live progress polling). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const job = await fetchTrainingJob(id);
  if (!job) return Response.json({ error: "Job not found" }, { status: 404 });
  return Response.json(job);
}

/** Delete a fine-tune job from the list. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const ok = await deleteTrainingJob(id);
  if (!ok) {
    return Response.json({ ok: false, error: "Transformer Lab menolak penghapusan job" }, { status: 502 });
  }
  return Response.json({ ok: true });
}
