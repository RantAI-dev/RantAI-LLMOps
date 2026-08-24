import type { NextRequest } from "next/server";

import { getInferenceStats, readRecentEvents } from "@/lib/inference-log-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Per-request inference traces for the Traces view: the most recent individual
 * requests (newest-first) plus the same aggregate the Dashboard shows, in one
 * round-trip. Metadata + metrics only — no prompt/response text is stored.
 * `?limit=` caps how many rows come back (default 200, hard max 1000).
 */
export async function GET(req: NextRequest) {
  const raw = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 1000) : 200;
  const [traces, stats] = await Promise.all([readRecentEvents(limit), getInferenceStats()]);
  return Response.json({ traces, stats });
}
