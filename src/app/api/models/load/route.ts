import type { NextRequest } from "next/server";

import { loadModel } from "@/lib/models-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Loads a downloaded model into VRAM (swapping out whatever is loaded). The
 * picker calls this when you select a model; the chat then targets it. Blocks
 * until the worker is up, so the client can show a "loading…" state.
 */
export async function POST(req: NextRequest) {
  let body: { modelId?: string; adaptor?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.modelId) {
    return Response.json({ error: "`modelId` is required" }, { status: 400 });
  }
  try {
    const loaded = await loadModel(body.modelId, body.adaptor);
    return Response.json({ loaded });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load model";
    return Response.json({ error: message }, { status: 502 });
  }
}
