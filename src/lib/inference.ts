/**
 * Server-only inference config for the chat BFF (`/api/chat`, `/api/models`). Do
 * NOT import this from a client component — these are plain (non-`NEXT_PUBLIC`)
 * env vars read on the Next server.
 *
 * The BFF talks to ANY OpenAI-compatible engine, so switching engines is just a
 * URL change:
 *   - B (quick test): Ollama       -> http://localhost:11434/v1
 *   - B (quick test): llama.cpp     -> http://localhost:8080/v1
 *   - A (our backend): Transformer Lab -> http://localhost:8338/v1
 *       (TL also needs a Bearer token + the X-Team-Id header — set
 *        INFERENCE_API_KEY and INFERENCE_TEAM_ID)
 */
export const INFERENCE_BASE_URL = (
  process.env.INFERENCE_BASE_URL ?? "http://localhost:11434/v1"
).replace(/\/$/, "");

/** Model name the engine expects (e.g. an Ollama tag, or a TL-loaded model id). */
export const INFERENCE_MODEL = process.env.INFERENCE_MODEL ?? "";

/** Bearer token. "dummy" is fine for Ollama/llama.cpp; a real JWT for Transformer Lab. */
export const INFERENCE_API_KEY = process.env.INFERENCE_API_KEY ?? "dummy";

/** Team id for Transformer Lab's multi-tenant auth (sent as the X-Team-Id header). */
export const INFERENCE_TEAM_ID = process.env.INFERENCE_TEAM_ID ?? "";

/**
 * Whether the upstream engine reliably supports SSE streaming
 * (`stream: true`). Some engines/loaders have broken streaming — notably
 * Transformer Lab's `llama_cpp_server` (GGUF) worker, which closes the
 * connection mid-stream. Set INFERENCE_STREAM=false for those: the BFF then
 * requests a non-streamed completion and re-emits it as SSE chunks, so the UI
 * still "types out" the answer while staying immune to engine streaming bugs.
 * Defaults to true (real streaming).
 */
export const INFERENCE_STREAM =
  (process.env.INFERENCE_STREAM ?? "true").toLowerCase() !== "false";

/** Build the upstream request headers (auth + optional team id). */
export function inferenceHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${INFERENCE_API_KEY}`,
    ...extra,
  };
  if (INFERENCE_TEAM_ID) headers["X-Team-Id"] = INFERENCE_TEAM_ID;
  return headers;
}
