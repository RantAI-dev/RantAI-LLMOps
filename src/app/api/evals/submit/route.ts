import type { NextRequest } from "next/server";

import { submitEval, type SubmitEvalParams } from "@/lib/evals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const maxDuration = 600;

/** Kicks off a benchmark eval on a model. Returns the job id to poll. */
export async function POST(req: NextRequest) {
  let body: Partial<SubmitEvalParams>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.model || !body.benchmark) {
    return Response.json({ error: "`model` and `benchmark` are required" }, { status: 400 });
  }
  try {
    const jobId = await submitEval(body as SubmitEvalParams);
    return Response.json({ jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start eval";
    return Response.json({ error: message }, { status: 502 });
  }
}
