import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { decisionConfigured, DecisionServerError, undeployDecision } from "@/lib/decision-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Unload a served decision model. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  if (!decisionConfigured()) {
    return Response.json({ error: "The decision server is not configured" }, { status: 404 });
  }
  const { name } = await params;
  try {
    await undeployDecision(name);
    return Response.json({ unloaded: name });
  } catch (err) {
    const status = err instanceof DecisionServerError ? err.status : 502;
    return Response.json({ error: err instanceof Error ? err.message : "Unload failed" }, { status });
  }
}
