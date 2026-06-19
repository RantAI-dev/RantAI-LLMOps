"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  loadChatSessions,
  makeEmptySession,
  saveChatSessions,
} from "@/modules/playground/lib/storage";
import type { ChatMessage, ChatSession } from "@/modules/playground/types";

type State = { sessions: ChatSession[]; activeId: string };

function init(): State {
  const loaded = loadChatSessions();
  const sessions = loaded.length > 0 ? loaded : [makeEmptySession()];
  return { sessions, activeId: sessions[0]!.id };
}

/** Persisted (localStorage) chat sessions + the active conversation. */
export function useChatSessions() {
  const [state, setState] = useState<State>(init);

  // Persist (debounced) so token-by-token streaming doesn't thrash localStorage.
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => saveChatSessions(state.sessions), 400);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [state.sessions]);

  const activeSession = state.sessions.find((s) => s.id === state.activeId) ?? null;

  const newChat = useCallback(() => {
    setState((st) => {
      // Reuse the current chat if it's still empty (avoid piling up "New chat"s).
      const active = st.sessions.find((s) => s.id === st.activeId);
      if (active && active.messages.length === 0) return st;
      const s = makeEmptySession();
      return { sessions: [s, ...st.sessions], activeId: s.id };
    });
  }, []);

  const selectChat = useCallback((id: string) => {
    setState((st) => ({ ...st, activeId: id }));
  }, []);

  const deleteChat = useCallback((id: string) => {
    setState((st) => {
      const sessions = st.sessions.filter((s) => s.id !== id);
      if (sessions.length === 0) {
        const s = makeEmptySession();
        return { sessions: [s], activeId: s.id };
      }
      return { sessions, activeId: st.activeId === id ? sessions[0]!.id : st.activeId };
    });
  }, []);

  const setActiveMessages = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    setState((st) => ({
      ...st,
      sessions: st.sessions.map((s) => {
        if (s.id !== st.activeId) return s;
        const messages = updater(s.messages);
        const title =
          s.title === "New chat" && messages[0]?.role === "user"
            ? messages[0].content.slice(0, 48)
            : s.title;
        return { ...s, messages, title, updatedAt: new Date().toISOString() };
      }),
    }));
  }, []);

  return {
    sessions: state.sessions,
    activeId: state.activeId,
    activeSession,
    newChat,
    selectChat,
    deleteChat,
    setActiveMessages,
  };
}
