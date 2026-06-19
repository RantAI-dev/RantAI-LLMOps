"use client";

import { ChatArea } from "@/modules/playground/components/chat-area";
import { ChatSessionsSidebar } from "@/modules/playground/components/chat-sessions-sidebar";
import { useChatSessions } from "@/modules/playground/hooks/use-chat-sessions";

export function ChatPlayground() {
  const { sessions, activeId, activeSession, newChat, selectChat, deleteChat, setActiveMessages } =
    useChatSessions();

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
        <ChatArea key={activeSession.id} messages={activeSession.messages} setMessages={setActiveMessages} />
      ) : null}
    </div>
  );
}
