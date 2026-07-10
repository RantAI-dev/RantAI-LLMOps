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
  // Request-send time — the anchor for time-to-first-token.
  const t0 = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(`${OLLAMA_V1}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }, // Ollama needs no auth
      body: JSON.stringify({
        model,
        messages,
        stream: INFERENCE_STREAM,
        // Ask the engine for token usage on the final chunk (per-response metrics).
        stream_options: { include_usage: true },
        temperature: body.temperature ?? 0.7,
        max_tokens: body.max_tokens ?? 1024,
        // Small repetition penalties keep small quantized models from getting
        // stuck in "…1 kg sawi hijau, 1 kg sawi hijau…" degeneration loops.
        frequency_penalty: body.frequency_penalty ?? 0.4,
        presence_penalty: body.presence_penalty ?? 0.3,
      }),
      // Abort if the client disconnects, and hard-cap at 10 min so a hung engine
      // can't pin a request worker indefinitely.
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(10 * 60_000)]),
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

  // Real streaming path: pass the OpenAI-compatible SSE stream straight through,
  // tapped to append per-response inference metrics after it ends.
  if (INFERENCE_STREAM) {
    return new Response(tapChatMetrics(upstream.body, t0), { headers: SSE_HEADERS });
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
 * Forward Ollama's SSE unchanged, but tap it to measure per-response metrics:
 * time-to-first-token (first content chunk), token counts (from the `usage`
 * chunk that `stream_options.include_usage` adds), and tokens/sec. Once the
 * stream ends, append a `data: {"rantai_metrics": {…}}` event — the UI reads it
 * to show the stats and (later) the BFF logs it. The raw content stream is
 * untouched, so rendering is unaffected. The client reads until the stream
 * closes (not `[DONE]`), so appending in `flush` is safe.
 */
function tapChatMetrics(body: ReadableStream<Uint8Array>, t0: number): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let tFirst = 0;
  let finishReason = "";
  let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;

  const tap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      // Inspect a decoded copy for timing/usage; forward the raw bytes unchanged.
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const obj = JSON.parse(data);
          if (obj.usage) usage = obj.usage;
          const choice = obj.choices?.[0];
          if (!tFirst && choice?.delta?.content) tFirst = Date.now();
          if (choice?.finish_reason) finishReason = String(choice.finish_reason);
        } catch {
          /* ignore keep-alives / non-JSON */
        }
      }
      controller.enqueue(chunk);
    },
    flush(controller) {
      const now = Date.now();
      const out = usage?.completion_tokens ?? 0;
      const genMs = tFirst ? now - tFirst : 0;
      const metrics = {
        tokens: usage?.total_tokens ?? 0,
        promptTokens: usage?.prompt_tokens ?? 0,
        completionTokens: out,
        tokS: genMs > 0 && out ? Math.round((out / (genMs / 1000)) * 10) / 10 : 0,
        ttftMs: tFirst ? tFirst - t0 : 0,
        totalMs: now - t0,
        finishReason,
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ rantai_metrics: metrics })}\n\n`));
    },
  });
  return body.pipeThrough(tap);
}

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
