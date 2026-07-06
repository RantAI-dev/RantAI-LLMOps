import type { NextRequest } from "next/server";

import { jobOutput } from "@/lib/tasks-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Raw log/output for one job (`/jobs/{id}/output`). Powers the task drawer logs. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Optional hint from the drawer so we skip the cross-experiment fan-out resolver.
  const experimentId = req.nextUrl.searchParams.get("experimentId") ?? undefined;
  try {
    const output = await jobOutput(id, experimentId);
    return Response.json({ output });
  } catch (err) {
    console.error("[api/tasks/[id]/output] Transformer Lab unreachable or rejected the request:", err);
    return Response.json({ output: "" });
  }
}
