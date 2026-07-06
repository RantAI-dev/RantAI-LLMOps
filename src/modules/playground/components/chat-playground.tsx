"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ChatArea } from "@/modules/playground/components/chat-area";
import { ChatSessionsSidebar } from "@/modules/playground/components/chat-sessions-sidebar";
import { useChatSessions } from "@/modules/playground/hooks/use-chat-sessions";

export function ChatPlayground() {
  const {
    sessions,
    activeId,
    activeSession,
    loaded,
    newChat,
    selectChat,
    deleteChat,
    setActiveMessages,
  } = useChatSessions();

  // Arriving from Model Registry's "Test" (`/interact?model=<id>`): open a FRESH
  // chat with that model preselected. We wait for `loaded` first — creating the
  // chat before the saved conversations arrive would let the load discard it (an
  // empty session isn't kept). `presetModel` lives here (not in the per-session
  // ChatArea, which remounts) and is cleared once the new chat's ChatArea applies it.
  const [presetModel, setPresetModel] = useState("");
  const clearPreset = useCallback(() => setPresetModel(""), []);
  const preselectHandled = useRef(false);
  useEffect(() => {
    if (!loaded || preselectHandled.current) return;
    preselectHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    const m = params.get("model");
    if (!m) return;
    const t = setTimeout(() => {
      newChat();
      setPresetModel(m);
      params.delete("model");
      const qs = params.toString();
      window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    }, 0);
    return () => clearTimeout(t);
  }, [loaded, newChat]);

  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-lg border border-hairline bg-white">
      <ChatSessionsSidebar
        sessions={sessions}
        activeId={activeId}
        onNew={newChat}
        onSelect={selectChat}
        onDelete={deleteChat}
      />
      {activeSession ? (
        <ChatArea
          key={activeSession.id}
          messages={activeSession.messages}
          setMessages={setActiveMessages}
          presetModel={presetModel}
          onPresetApplied={clearPreset}
        />
      ) : null}
    </div>
  );
}
