import type { ChatSession } from "@/modules/playground/types";

// Chat history is persisted server-side (see use-chat-sessions + /api/conversations).
// These remain the small client-side helpers for creating new sessions.

export function generateSessionId(): string {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function makeEmptySession(): ChatSession {
  const now = new Date().toISOString();
  return { id: generateSessionId(), title: "New chat", messages: [], createdAt: now, updatedAt: now };
}
