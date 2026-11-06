import type { MessageContent } from "@/lib/chat-content";

export type ChatRole = "system" | "user" | "assistant";

/** Per-response inference metrics, computed in the chat BFF from Ollama's token
 *  usage + measured timing (shown under each assistant reply, like TL). */
export type ChatMetrics = {
  /** Total tokens (prompt + completion). */
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  /** Output tokens / second (completion tokens over generation time). */
  tokS: number;
  /** Time to first token, ms (request sent → first content chunk). */
  ttftMs: number;
  /** Total request time, ms. */
  totalMs: number;
  /** Why generation stopped: "stop" (natural), "length" (hit max_tokens = the
   *  reply was cut off), or another engine reason. Empty if unknown. */
  finishReason: string;
};

export type ChatMessage = {
  role: ChatRole;
  /** A string, or parts with images. Images are always stored references (`/api/chat-images/<sha>`),
   *  never base64, so a saved conversation stays small. */
  content: MessageContent;
  /** Assistant messages only: inference metrics for this reply. */
  metrics?: ChatMetrics;
};

export type ChatSession = {
  id: string;
  title: string;
  model?: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
};
