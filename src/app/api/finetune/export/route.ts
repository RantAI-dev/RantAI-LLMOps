import type { NextRequest } from "next/server";

import { EXPORT_OUTTYPES, exportFineTunedToGguf, isExportOuttype } from "@/lib/finetune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GGUF conversion of a model can take a minute or two.
export const maxDuration = 300; // Vercel Hobby caps serverless functions at 300s

/**
 * Serves a fine-tune by exporting it to GGUF and importing it into Ollama, and
 * STREAMS live stage progress back as SSE so the "Export to use" action can show
 * what it's doing (merge → convert → import) instead of an opaque spinner.
 * `fusedModelId` is the TRAIN job id. Emits `data: {stage, percent?}` lines, then
 * a final `data: {done, tag}` (plus `vl: {gguf, mmproj, command}` and an empty tag for a vision-language
 * model, which Ollama cannot load) or `data: {error}`. Optional `outtype`: q8_0 (default), f16 or bf16.
 */
export async function POST(req: NextRequest) {
  let body: { fusedModelId?: string; outtype?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.fusedModelId) {
    return Response.json({ error: "`fusedModelId` is required" }, { status: 400 });
  }
  const fusedModelId = body.fusedModelId;
  if (body.outtype !== undefined && !isExportOuttype(body.outtype)) {
    return Response.json({ error: `\`outtype\` must be one of ${EXPORT_OUTTYPES.join(", ")}` }, { status: 400 });
  }
  const outtype = body.outtype ?? "q8_0";

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const result = await exportFineTunedToGguf(
          fusedModelId,
          (stage) => send({ stage: stage.message, percent: stage.percent }),
          outtype
        );
        send({ done: true, tag: result.tag, ...(result.vl ? { vl: result.vl } : {}) });
      } catch (err) {
        send({ error: err instanceof Error ? err.message : "Export failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
