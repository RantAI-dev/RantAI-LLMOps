import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { DuoError } from "@/lib/duo";
import { getDuoEval } from "@/lib/duo-evals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One run with its points (progress while it is running). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    return Response.json(await getDuoEval(id));
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Duo eval request failed" },
      { status: err instanceof DuoError ? err.status : 502 }
    );
  }
}
