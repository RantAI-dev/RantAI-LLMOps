import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { DuoError } from "@/lib/duo";
import { cancelDuoEval } from "@/lib/duo-evals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stop a running comparison; what finished so far stays in the run. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    await cancelDuoEval(id);
    return new Response(null, { status: 202 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Duo eval request failed" },
      { status: err instanceof DuoError ? err.status : 502 }
    );
  }
}
