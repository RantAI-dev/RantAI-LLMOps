import type { ChatSession } from "@/modules/playground/types";

const KEY = "nqr.chat.sessions.v1";

export function loadChatSessions(): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as ChatSession[]) : [];
  } catch {
    return [];
  }
}

export function saveChatSessions(sessions: ChatSession[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(sessions));
  } catch {
    // ignore quota / serialization errors — chat history is best-effort
  }
}

export function generateSessionId(): string {
  return `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function makeEmptySession(): ChatSession {
  const now = new Date().toISOString();
  return { id: generateSessionId(), title: "New chat", messages: [], createdAt: now, updatedAt: now };
}
