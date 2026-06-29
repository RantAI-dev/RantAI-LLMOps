import type { NextRequest } from "next/server";

import { loadModel } from "@/lib/models-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Loads" a model for serving by ensuring Ollama has it pulled (Ollama then
 * auto-loads it into VRAM on the first chat request). The picker calls this when
 * you select a model. `modelId` is an Ollama tag. Blocks until the pull is done.
 */
export async function POST(req: NextRequest) {
  let body: { modelId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.modelId) {
    return Response.json({ error: "`modelId` is required" }, { status: 400 });
  }
  try {
    const loaded = await loadModel(body.modelId);
    return Response.json({ loaded });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load model";
    return Response.json({ error: message }, { status: 502 });
  }
}
