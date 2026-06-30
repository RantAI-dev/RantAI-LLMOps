import type { NextRequest } from "next/server";

import { pullOllamaModelProgress } from "@/lib/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A model download can take a while (GGUF files are ~1–3 GB).
export const maxDuration = 600;

/**
 * Pull a model into Ollama and STREAM progress back as SSE so the UI can show a
 * download bar. `model` (or legacy `repo`) is anything Ollama can pull: an
 * Ollama library tag (`qwen2.5:1.5b`) or a Hugging Face GGUF repo
 * (`hf.co/{owner}/{repo}:{quant}`). Emits `data: {status, percent}` lines, then
 * a final `data: {done:true}` or `data: {error}`.
 */
export async function POST(req: NextRequest) {
  let body: { model?: string; repo?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const ref = (body.model ?? body.repo)?.trim();
  if (!ref) {
    return Response.json({ error: "`model` is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for await (const p of pullOllamaModelProgress(ref)) {
          send({ status: p.status, percent: p.percent });
        }
        send({ done: true });
      } catch (err) {
        send({ error: err instanceof Error ? err.message : "Download failed" });
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
