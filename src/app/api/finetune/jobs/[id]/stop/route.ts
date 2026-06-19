import type { NextRequest } from "next/server";

import { stopTrainingJob } from "@/lib/finetune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ask a running fine-tune job to stop. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  await stopTrainingJob(id);
  return Response.json({ ok: true });
}
