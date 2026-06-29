/**
 * Server-only helper for one-shot (non-streaming) completions against Ollama.
 * Shared by `/api/serve/test` and `/api/generations/complete` (output compare).
 *
 * v0.40.0: inference runs on Ollama (TL no longer serves models). Pass an
 * explicit `model` (Ollama tag) to target a specific one; otherwise we use
 * whatever is hot in VRAM.
 */
import { OLLAMA_V1, loadedOllamaModel } from "@/lib/ollama";

export type CompletionResult = { model: string; reply: string };

export async function completeOnLoadedModel(
  prompt: string,
  opts: { temperature?: number; maxTokens?: number; model?: string } = {}
): Promise<CompletionResult> {
  const model = opts.model || (await loadedOllamaModel());
  if (!model) throw new Error("Tidak ada model yang sedang dimuat. Load satu dulu.");

  const res = await fetch(`${OLLAMA_V1}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      stream: false,
      max_tokens: opts.maxTokens ?? 256,
      temperature: opts.temperature ?? 0.3,
    }),
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
