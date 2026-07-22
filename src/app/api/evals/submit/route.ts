import type { NextRequest } from "next/server";

import { submitEval, type SubmitEvalParams } from "@/lib/evals";
import { logServerError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const maxDuration = 600;

/**
 * Kicks off a benchmark eval on a model.
 *
 * Fine-tunes are merged (adapter → full model) before launch, which for a 9B
 * model is minutes of work. Awaiting that inside the request held the HTTP
 * connection open long enough for a proxy to cut it — the browser saw a bare
 * "Failed to fetch" even though the job launched fine. So `background: true`
 * (the single-run UI) returns immediately and lets the job appear via polling;
 * Compare keeps the synchronous path because it needs the job id to sequence runs.
 */
export async function POST(req: NextRequest) {
  let body: Partial<SubmitEvalParams> & { background?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.model || !body.benchmark) {
    return Response.json({ error: "`model` and `benchmark` are required" }, { status: 400 });
  }

  const params = body as SubmitEvalParams;
  if (body.background) {
    // Not awaited: the app is a long-lived process, so the merge + launch finish
    // after the response. Failures are logged; the UI surfaces the launched job
    // (or its absence) via the job list, and adapter-less fine-tunes are already
    // filtered out before they can be picked.
    void submitEval(params).catch((err) => logServerError("evals/submit background", err));
    return Response.json({ pending: true });
  }

  try {
    const jobId = await submitEval(params);
    return Response.json({ jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start eval";
    return Response.json({ error: message }, { status: 502 });
  }
}
