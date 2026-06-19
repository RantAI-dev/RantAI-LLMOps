import type { NextRequest } from "next/server";

import { exportFineTunedToGguf } from "@/lib/finetune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GGUF conversion of a model can take a minute or two.
export const maxDuration = 600;

/**
 * Exports a fused fine-tuned model to GGUF so it becomes loadable for chat.
 * Called from the Fine-tuned tab's "Export" action.
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
    await exportFineTunedToGguf(body.fusedModelId);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
