/**
 * Server-only helper for one-shot (non-streaming) completions against whatever
 * model Transformer Lab currently has loaded. Shared by `/api/serve/test` and
 * `/api/generations/complete` (output comparison).
 */
import { INFERENCE_BASE_URL, inferenceHeaders } from "@/lib/inference";
import { fetchLoaded } from "@/lib/models-catalog";

export type CompletionResult = { model: string; reply: string };

/**
 * Fire one non-streaming chat completion at the currently-served model. Resolves
 * the model id from what TL reports as loaded (so we never send a mismatched id).
 * Throws with TL's error message on failure.
 */
export async function completeOnLoadedModel(
  prompt: string,
  opts: { temperature?: number; maxTokens?: number } = {}
): Promise<CompletionResult> {
  const model = await fetchLoaded();
  if (!model) throw new Error("Tidak ada model yang sedang dimuat. Load satu dulu.");

  const res = await fetch(`${INFERENCE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: inferenceHeaders({ "Content-Type": "application/json" }),
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
