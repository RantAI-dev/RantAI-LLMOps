/**
 * Server-only helper for one-shot (non-streaming) completions against Ollama.
 * Shared by `/api/serve/test` and `/api/generations/complete` (output compare).
 *
 * v0.40.0: inference runs on Ollama (TL no longer serves models). Pass an
 * explicit `model` (Ollama tag) to target a specific one; otherwise we use
 * whatever is hot in VRAM.
 */
import { OLLAMA_V1, listOllamaModels, loadedOllamaModel } from "@/lib/ollama";

export type CompletionResult = { model: string; reply: string };

export async function completeOnLoadedModel(
  prompt: string,
  opts: { temperature?: number; maxTokens?: number; model?: string } = {}
): Promise<CompletionResult> {
  // Prefer the explicit model, then whatever is hot in VRAM, then any pulled
  // model (Ollama lazily loads it). Ollama serves all pulled models, so unlike
  // TL's single worker there's almost always something to answer with.
  const model =
    opts.model || (await loadedOllamaModel()) || (await listOllamaModels())[0]?.id || null;
  if (!model) {
    throw new Error("Belum ada model di Ollama. Pull/serve satu model dulu.");
  }

  const res = await fetch(`${OLLAMA_V1}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      max_tokens: opts.maxTokens ?? 256,
      temperature: opts.temperature ?? 0.3,
      // Small repetition penalties stop small/quantized models (especially a raw
      // base) from degenerating into "…Assistant adalah…Assistant adalah…" loops.
      // Matches the chat route so output-compare is a fair, loop-free read.
      frequency_penalty: 0.4,
      presence_penalty: 0.3,
    }),
    // Bound the wait so a hung engine can't pin the request worker.
    signal: AbortSignal.timeout(2 * 60_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string } | string;
  };
  if (!res.ok) {
    const msg =
      typeof data.error === "string" ? data.error : data.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return { model, reply: data.choices?.[0]?.message?.content ?? "" };
}
