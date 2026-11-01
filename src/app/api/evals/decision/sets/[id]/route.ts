import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { deleteDecisionEvalSet } from "@/lib/decision-eval-set-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Remove a test set. Past runs keep their own report; only the set's rows go. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    await deleteDecisionEvalSet(id);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Invalid test set id" }, { status: 400 });
  }
}
