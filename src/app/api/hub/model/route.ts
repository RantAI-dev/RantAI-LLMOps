import type { NextRequest } from "next/server";

import { hfModelDetail } from "@/lib/hf-hub";
import { logServerError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One HF model's GGUF quants + gated status (drives the download quant picker).
 * `repo` is a query param (it contains a slash, so it can't be a path segment).
 */
export async function GET(req: NextRequest) {
  const repo = req.nextUrl.searchParams.get("repo")?.trim();
  if (!repo) {
    return Response.json({ error: "`repo` is required" }, { status: 400 });
  }
  try {
    return Response.json(await hfModelDetail(repo));
  } catch (err) {
    logServerError("hub/model", err);
    return Response.json({ error: "Could not load model details" }, { status: 502 });
  }
}
