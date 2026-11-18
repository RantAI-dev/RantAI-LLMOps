import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { duoConfigured, DuoError } from "@/lib/duo";
import { listDuoEvals, parseDuoEvalRequest, startDuoEval } from "@/lib/duo-evals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const failed = (err: unknown) =>
  Response.json(
    { error: err instanceof Error ? err.message : "Duo eval request failed" },
    { status: err instanceof DuoError ? err.status : 502 }
  );

/** The gateway's datasets and its eval runs, newest first. */
export async function GET(req: NextRequest) {
  const denied = await guardApi(req);
  if (denied) return denied;
  if (!duoConfigured()) return Response.json({ configured: false, datasets: [], runs: [] });
  try {
    return Response.json({ configured: true, ...(await listDuoEvals()) });
  } catch (err) {
    return failed(err);
  }
}

/** Start a comparison: `{ benchmark, systems, maxItems?, seed? }` → the run (it keeps going on the gateway). */
export async function POST(req: NextRequest) {
  const denied = await guardApi(req);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    return Response.json(await startDuoEval(parseDuoEvalRequest(body)), { status: 202 });
  } catch (err) {
    return failed(err);
  }
}
