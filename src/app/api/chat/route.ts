import type { NextRequest } from "next/server";

import { INFERENCE_MODEL, INFERENCE_STREAM } from "@/lib/inference";
import { OLLAMA_V1, loadedOllamaModel } from "@/lib/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatBody = {
  messages?: Array<{ role: string; content: string }>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
};

/**
 * Backend-for-Frontend chat proxy. The Interact UI POSTs `{ messages, model? }`
 * here; we forward to Ollama's OpenAI-compatible `/v1/chat/completions` and pipe
 * the SSE stream straight back to the browser.
 *
 * v0.40.0 note: Transformer Lab no longer serves inference itself (no `/v1`), so
 * the chat engine is Ollama (run on the host). It serves every pulled model at
 * once, so the model name comes from the client's selection (`body.model`),
 * falling back to whatever is hot in VRAM.
 */
export async function POST(req: NextRequest) {
  let body: ChatBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "`messages` array is required" }, { status: 400 });
  }

  // Ollama serves all pulled models simultaneously, so the model name is the
  // client's selection. Fall back to whatever is hot in VRAM, then the env
  // default. (No HTTP-403 "wrong model" trap like TL's single-worker model.)
  const model = body.model || (await loadedOllamaModel()) || INFERENCE_MODEL || "default";
  let upstream: Response;
  try {
    upstream = await fetch(`${OLLAMA_V1}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }, // Ollama needs no auth
      body: JSON.stringify({
        model,
        messages,
        stream: INFERENCE_STREAM,
        temperature: body.temperature ?? 0.7,
        max_tokens: body.max_tokens ?? 1024,
        // Small repetition penalties keep small quantized models from getting
        // stuck in "…1 kg sawi hijau, 1 kg sawi hijau…" degeneration loops.
        frequency_penalty: body.frequency_penalty ?? 0.4,
        presence_penalty: body.presence_penalty ?? 0.3,
      }),
    });
  } catch {
    return Response.json(
      {
        error: `Could not reach Ollama at ${OLLAMA_V1}. Is it running? (start it in WSL: ~/start_ollama.sh, or set OLLAMA_BASE_URL in .env.local)`,
      },
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    return Response.json(
      { error: detail || `Inference engine returned ${upstream.status}` },
      { status: upstream.status || 502 }
    );
  }

  // Real streaming path: pass the OpenAI-compatible SSE stream straight through.
  if (INFERENCE_STREAM) {
    return new Response(upstream.body, { headers: SSE_HEADERS });
  }

  // Fallback path (engine streaming is unreliable, e.g. TL llama.cpp GGUF):
  // we asked for a non-streamed completion; read the full message and re-emit
  // it as OpenAI-style SSE chunks so the UI still types it out.
  const completion = (await upstream.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: string } }> }
    | null;
  const content = completion?.choices?.[0]?.message?.content ?? "";
  return new Response(synthesizeSseStream(content, model), { headers: SSE_HEADERS });
}

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
} as const;

/**
 * Turns a complete assistant message into an OpenAI-compatible SSE stream of
 * `chat.completion.chunk` deltas, emitted in small pieces with a tiny delay so
 * the client renders a natural "typing" effect. Used when the upstream engine
 * can't stream reliably.
 */
function synthesizeSseStream(content: string, model: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  // Split into small word-ish pieces (keep trailing spaces with each word).
  const pieces = content.match(/\S+\s*/g) ?? [];
  const frame = (delta: object) =>
    encoder.encode(
      `data: ${JSON.stringify({
        object: "chat.completion.chunk",
        model,
        choices: [{ index: 0, delta, finish_reason: null }],
      })}\n\n`
    );

  return new ReadableStream({
    async start(controller) {
      controller.enqueue(frame({ role: "assistant" }));
      for (const piece of pieces) {
        controller.enqueue(frame({ content: piece }));
        await new Promise((r) => setTimeout(r, 18));
      }
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            object: "chat.completion.chunk",
            model,
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          })}\n\n`
        )
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}
