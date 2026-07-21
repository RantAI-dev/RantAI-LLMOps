import type { NextRequest } from "next/server";

import { INFERENCE_STREAM } from "@/lib/inference";
import { resolveChatModel, resolveEngine } from "@/lib/inference-engines";
import { logInference } from "@/lib/inference-log-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Default cap on output tokens per reply. The old 1024 truncated long answers
 *  ("terpotong") — especially reasoning models (which spend tokens "thinking")
 *  and step-by-step/recipe replies. Tunable per deployment via CHAT_MAX_TOKENS
 *  (e.g. 8192) with no rebuild. A per-request body.max_tokens still overrides. */
const DEFAULT_MAX_TOKENS = Number(process.env.CHAT_MAX_TOKENS) || 4096;

type ChatBody = {
  messages?: Array<{ role: string; content: string }>;
  model?: string;
  /** Which engine to serve from ("ollama" | "vllm"); defaults to Ollama. */
  engine?: string;
  temperature?: number;
  max_tokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
};

/**
 * Backend-for-Frontend chat proxy. The Interact UI POSTs `{ messages, model?,
 * engine? }` here; we forward to the selected engine's OpenAI-compatible
 * `/v1/chat/completions` and pipe the SSE stream straight back to the browser.
 *
 * v0.40.0 note: Transformer Lab no longer serves inference itself (no `/v1`), so
 * inference goes to an external engine — Ollama (default) or vLLM. Both speak
 * `/v1`, so only the base URL, headers, and model resolution differ; the stream
 * tap below is engine-agnostic.
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

  // Pick the engine (default Ollama) and its model. A named-but-unconfigured
  // engine (vLLM before deployment) is a clear 400, not a connection error.
  const engine = resolveEngine(body.engine);
  if (!engine.configured) {
    return Response.json(
      { error: `Engine ${engine.label} belum dikonfigurasi (VLLM_BASE_URL belum diset).` },
      { status: 400 }
    );
  }
  const model = await resolveChatModel(engine, body.model);
  // Request-send time — the anchor for time-to-first-token.
  const t0 = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(`${engine.v1BaseUrl}/chat/completions`, {
      method: "POST",
      headers: engine.headers,
      body: JSON.stringify({
        model,
        messages,
        stream: INFERENCE_STREAM,
        // Ask the engine for token usage on the final chunk (per-response metrics).
        stream_options: { include_usage: true },
        temperature: body.temperature ?? 0.7,
        max_tokens: body.max_tokens ?? DEFAULT_MAX_TOKENS,
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
    logChatError(model, t0);
    const hint =
      engine.id === "ollama"
        ? " (start it in WSL: ~/start_ollama.sh, or set OLLAMA_BASE_URL in .env.local)"
        : "";
    return Response.json(
      { error: `Tidak bisa menjangkau ${engine.label} di ${engine.v1BaseUrl}. Sedang jalan?${hint}` },
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    logChatError(model, t0);
    const detail = await upstream.text().catch(() => "");
    return Response.json(
      { error: detail || `Inference engine returned ${upstream.status}` },
      { status: upstream.status || 502 }
    );
  }

  // Real streaming path: pass the OpenAI-compatible SSE stream straight through,
  // tapped to append per-response inference metrics after it ends.
  if (INFERENCE_STREAM) {
    return new Response(tapChatMetrics(upstream.body, t0, model), { headers: SSE_HEADERS });
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
/** Log a failed chat request (Ollama unreachable / non-OK) so the Dashboard's
 *  error rate is real. Fire-and-forget. */
function logChatError(model: string, t0: number): void {
  void logInference({
    ts: Date.now(),
    model,
    status: "error",
    tokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    tokS: 0,
    ttftMs: 0,
    totalMs: Date.now() - t0,
    finishReason: "error",
  });
}

function tapChatMetrics(body: ReadableStream<Uint8Array>, t0: number, model: string): ReadableStream<Uint8Array> {
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
      // Persist for the Dashboard's usage analytics (fire-and-forget).
      void logInference({ ts: now, model, status: "ok", ...metrics });
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
