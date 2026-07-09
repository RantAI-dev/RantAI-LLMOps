import type { NextRequest } from "next/server";

import { submitFinetune, type SubmitFinetuneParams } from "@/lib/finetune";
import { getHfToken } from "@/lib/settings-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dataset download (if needed) + task setup can take a little while.
export const maxDuration = 600;

/**
 * Kicks off a LoRA fine-tune: creates and queues a TRAIN task on Transformer
 * Lab. Returns the job id; the UI then polls `/api/finetune/jobs`.
 */
export async function POST(req: NextRequest) {
  let body: Partial<SubmitFinetuneParams>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.baseModel || !body.dataset || !body.adaptorName) {
    return Response.json(
      { error: "`baseModel`, `dataset` and `adaptorName` are required" },
      { status: 400 }
    );
  }
  // Gated base models (Llama, etc.) need an HF token at download time. Inject the
  // saved one server-side so the secret never has to ride in the request body.
  if (!body.hfToken) {
    const stored = await getHfToken();
    if (stored) body.hfToken = stored;
  }
  try {
    const jobId = await submitFinetune(body as SubmitFinetuneParams);
    return Response.json({ jobId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start fine-tune";
    return Response.json({ error: message }, { status: 502 });
  }
}
