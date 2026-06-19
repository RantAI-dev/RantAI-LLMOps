"use client";

import { MessageSquarePlus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatSession } from "@/modules/playground/types";

export function ChatSessionsSidebar({
  sessions,
  activeId,
  onNew,
  onSelect,
  onDelete,
}: {
  sessions: ChatSession[];
  activeId: string;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-hairline bg-surface">
      <div className="p-2">
        <Button type="button" variant="outline" className="w-full justify-start gap-2" onClick={onNew}>
          <MessageSquarePlus className="size-4" /> New chat
        </Button>
      </div>
      <div className="px-3 pb-1 text-[12px] font-medium text-ink-soft">Recents</div>
      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={cn(
              "group flex items-center rounded-md",
              s.id === activeId ? "bg-surface-2" : "hover:bg-surface-2"
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(s.id)}
              className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm text-primary outline-none"
              title={s.title}
            >
              {s.title || "New chat"}
            </button>
            <button
              type="button"
              onClick={() => onDelete(s.id)}
              className="mr-1 hidden shrink-0 rounded p-1 text-ink-faint-strong outline-none hover:text-danger group-hover:block"
              aria-label="Delete chat"
              title="Delete chat"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
