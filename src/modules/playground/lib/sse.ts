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
