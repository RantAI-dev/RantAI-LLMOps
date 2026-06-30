"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { makeEmptySession } from "@/modules/playground/lib/storage";
import type { ChatMessage, ChatSession } from "@/modules/playground/types";

type State = { sessions: ChatSession[]; activeId: string };

function initialState(): State {
  const s = makeEmptySession();
  return { sessions: [s], activeId: s.id };
}

/**
 * Chat sessions persisted server-side (TL `conversations` router via
 * `/api/conversations`), so history follows the team, not one browser. Starts
 * with an empty session for instant render, then loads the saved ones on mount.
 */
export function useChatSessions() {
  const [state, setState] = useState<State>(initialState);
  const loadedRef = useRef(false);

  // Load saved conversations on mount.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/conversations", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { conversations?: ChatSession[] } | null) => {
        loadedRef.current = true;
        const saved = data?.conversations ?? [];
        if (cancelled || saved.length === 0) return;
        setState((st) => {
          // Keep the current empty session only if the user already typed.
          const active = st.sessions.find((s) => s.id === st.activeId);
          const keep = active && active.messages.length > 0 ? [active] : [];
          const sessions = [...keep, ...saved.filter((s) => !keep.some((k) => k.id === s.id))];
          return { sessions, activeId: sessions[0]!.id };
        });
      })
      .catch(() => {
        loadedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist the active session (debounced) once it has content.
  const timer = useRef<number | null>(null);
  useEffect(() => {
    const active = state.sessions.find((s) => s.id === state.activeId);
    if (!loadedRef.current || !active || active.messages.length === 0) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      void fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(active),
      });
    }, 500);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [state.sessions, state.activeId]);

  const activeSession = state.sessions.find((s) => s.id === state.activeId) ?? null;

  const newChat = useCallback(() => {
    setState((st) => {
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
    void fetch(`/api/conversations?id=${encodeURIComponent(id)}`, { method: "DELETE" });
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
