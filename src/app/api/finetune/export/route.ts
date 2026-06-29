import type { NextRequest } from "next/server";

import { exportFineTunedToGguf } from "@/lib/finetune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GGUF conversion of a model can take a minute or two.
export const maxDuration = 600;

/**
 * Serves a fine-tune by exporting it to GGUF and importing it into Ollama.
 * Called from the Fine-tuned tab's "Export to use" action. `fusedModelId` is the
 * TRAIN job id. Returns the new Ollama tag.
 */
export async function POST(req: NextRequest) {
  let body: { fusedModelId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.fusedModelId) {
    return Response.json({ error: "`fusedModelId` is required" }, { status: 400 });
  }
  try {
    const tag = await exportFineTunedToGguf(body.fusedModelId);
    return Response.json({ ok: true, tag });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
