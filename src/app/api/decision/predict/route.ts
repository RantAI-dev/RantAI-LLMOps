import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { decisionConfigured, decisionPredict, DecisionServerError } from "@/lib/decision-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The "Try it" box on Deployments: ask a served decision model directly. `{ model, state, questions }`. */
export async function POST(req: NextRequest) {
  const denied = await guardApi(req);
  if (denied) return denied;
  if (!decisionConfigured()) {
    return Response.json({ error: "The decision server is not configured" }, { status: 404 });
  }
  let body: { model?: unknown; state?: unknown; questions?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.model !== "string" || !body.model) {
    return Response.json({ error: "`model` is required" }, { status: 400 });
  }
  try {
    return Response.json(await decisionPredict({ model: body.model, state: body.state, questions: body.questions }));
  } catch (err) {
    const status = err instanceof DecisionServerError ? err.status : 502;
    return Response.json({ error: err instanceof Error ? err.message : "Prediction failed" }, { status });
  }
}
