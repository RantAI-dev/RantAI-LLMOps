import type { NextRequest } from "next/server";

import { submitFinetune, type SubmitFinetuneParams } from "@/lib/finetune";
import { getGpuStatus } from "@/lib/gpu-metrics";
import { getHfToken } from "@/lib/settings-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Dataset download (if needed) + task setup can take a little while.
export const maxDuration = 300; // Vercel Hobby caps serverless functions at 300s

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
  // Coerce the numeric knobs. A client that sends `"2e-4"` for learningRate used
  // to sail through here and only blow up minutes later, deep inside SFTConfig,
  // with a message that never mentioned the real cause — a whole GPU run wasted.
  const NUMERIC = [
    "learningRate",
    "epochs",
    "batchSize",
    "maxSeqLength",
    "maxSteps",
    "loraR",
    "loraAlpha",
    "loraDropout",
  ] as const;
  for (const key of NUMERIC) {
    const raw = (body as Record<string, unknown>)[key];
    if (raw === undefined || raw === null) continue;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n)) {
      return Response.json(
        { error: `\`${key}\` must be a number, got ${JSON.stringify(raw)}` },
        { status: 400 }
      );
    }
    (body as Record<string, unknown>)[key] = n;
  }

  // Refuse early when the GPU is unreachable. Launching anyway costs several
  // minutes of venv build before the job dies with "No CUDA GPUs are available"
  // — and leaves ~6 GB behind. Only "blocked" is refused: a host with no GPU at
  // all may still be a deliberate CPU run.
  const gpu = await getGpuStatus();
  if (gpu.health === "blocked") {
    return Response.json(
      {
        error:
          `${gpu.detail ?? "The GPU is unreachable."} Recreate the backend container, ` +
          `then submit again.`,
      },
      { status: 503 }
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
