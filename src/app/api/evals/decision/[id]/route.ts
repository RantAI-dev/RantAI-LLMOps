import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { deleteDecisionEvalRun, readDecisionEvalRun } from "@/lib/decision-eval-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One decision eval run, including its per-row cases. Polled while running. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const run = await readDecisionEvalRun(id);
    if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
    return Response.json({ run });
  } catch {
    return Response.json({ error: "Invalid run id" }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    await deleteDecisionEvalRun(id);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Invalid run id" }, { status: 400 });
  }
}
