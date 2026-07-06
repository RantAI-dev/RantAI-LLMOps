"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { runOptimistic } from "@/lib/optimistic";
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
  // Exposed so callers can wait for the saved-conversation load before acting —
  // e.g. preselecting a model in a fresh chat, which a mid-load remount would drop.
  const [loaded, setLoaded] = useState(false);

  // Load saved conversations on mount.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/conversations", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { conversations?: ChatSession[] } | null) => {
        loadedRef.current = true;
        if (cancelled) return;
        setLoaded(true);
        const saved = data?.conversations ?? [];
        if (saved.length === 0) return;
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
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist the active session (debounced) once it has content. `pendingRef`
  // holds the not-yet-saved session so we can flush it on demand (e.g. when the
  // user switches away before the 500ms elapses) instead of dropping its edits.
  const timer = useRef<number | null>(null);
  const pendingRef = useRef<ChatSession | null>(null);

  const flushPending = useCallback(() => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const session = pendingRef.current;
    pendingRef.current = null;
    if (!session) return;
    void runOptimistic({
      request: () =>
        fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(session),
        }),
      errorMessage: "Gagal menyimpan chat ke server",
    });
  }, []);

  useEffect(() => {
    const active = state.sessions.find((s) => s.id === state.activeId);
    if (!loadedRef.current || !active || active.messages.length === 0) return;
    // Switching to a different session: flush the previous one's pending edits
    // first so a rapid switch (< debounce) can't lose them.
    if (pendingRef.current && pendingRef.current.id !== active.id) flushPending();
    pendingRef.current = active;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flushPending, 500);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [state.sessions, state.activeId, flushPending]);

  // Flush a still-pending save on unmount so the last edits aren't lost.
  useEffect(() => () => flushPending(), [flushPending]);

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
    // Drop any pending save for this id so a queued POST can't resurrect the
    // chat just after we delete it server-side.
    if (pendingRef.current?.id === id) {
      pendingRef.current = null;
      if (timer.current) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    }
    let removed: ChatSession | undefined;
    setState((st) => {
      removed = st.sessions.find((s) => s.id === id);
      const sessions = st.sessions.filter((s) => s.id !== id);
      if (sessions.length === 0) {
        const s = makeEmptySession();
        return { sessions: [s], activeId: s.id };
      }
      return { sessions, activeId: st.activeId === id ? sessions[0]!.id : st.activeId };
    });
    void runOptimistic({
      request: () => fetch(`/api/conversations?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
      // Restore the chat if the server delete failed, so the UI stays honest.
      rollback: () =>
        setState((st) =>
          removed && !st.sessions.some((s) => s.id === removed!.id)
            ? { ...st, sessions: [removed, ...st.sessions] }
            : st
        ),
      errorMessage: "Gagal menghapus chat di server",
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
    loaded,
    newChat,
    selectChat,
    deleteChat,
    setActiveMessages,
  };
}
