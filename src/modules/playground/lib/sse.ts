import type { ChatMetrics } from "@/modules/playground/types";

/**
 * Extract the assistant text delta from one line of an OpenAI-compatible SSE
 * stream (`data: {json}`). Returns the incremental content string, or null for
 * non-data lines, keep-alives, the `[DONE]` sentinel, or unparseable payloads.
 */
export function parseChatSseLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;

  const payload = trimmed.slice("data:".length).trim();
  if (payload === "" || payload === "[DONE]") return null;

  try {
    const json = JSON.parse(payload);
    const delta = json?.choices?.[0]?.delta?.content;
    return typeof delta === "string" ? delta : null;
  } catch {
    return null;
  }
}

/**
 * Extract the injected `rantai_metrics` payload from one SSE line — the chat BFF
 * appends `data: {"rantai_metrics": {...}}` once the reply finishes. Returns the
 * metrics object, or null for any other line.
 */
export function parseChatMetrics(line: string): ChatMetrics | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice("data:".length).trim();
  if (payload === "" || payload === "[DONE]") return null;
  try {
    const m = JSON.parse(payload)?.rantai_metrics;
    return m && typeof m === "object" ? (m as ChatMetrics) : null;
  } catch {
    return null;
  }
}

/**
 * Extract a top-level `error` string from one SSE line — the chat BFF can emit a
 * `data: {"error": "..."}` frame mid-stream (e.g. the engine dies partway). The
 * delta/metrics parsers ignore it, so surface it separately. Returns the error
 * message, or null for any other line.
 */
export function parseChatSseError(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice("data:".length).trim();
  if (payload === "" || payload === "[DONE]") return null;
  try {
    const err = JSON.parse(payload)?.error;
    return typeof err === "string" ? err : null;
  } catch {
    return null;
  }
}
