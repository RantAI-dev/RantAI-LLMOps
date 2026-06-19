"use client";

import { Bot, Send, Square, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ModelPicker } from "@/modules/playground/components/model-picker";
import { parseChatSseLine } from "@/modules/playground/lib/sse";
import type { ChatMessage } from "@/modules/playground/types";
import { cn } from "@/lib/utils";

type SetMessages = (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;

export function ChatArea({
  messages,
  setMessages,
}: {
  messages: ChatMessage[];
  setMessages: SetMessages;
}) {
  const [input, setInput] = useState("");
  const [model, setModel] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || isStreaming) return;

    setError(null);
    const history: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(() => [...history, { role: "assistant", content: "" }]);
    setInput("");
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, model: model || undefined }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const delta = parseChatSseLine(line);
          if (delta) setMessages((prev) => appendDelta(prev, delta));
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return; // user stopped — keep partial
      setError((err as Error).message);
      setMessages((prev) =>
        prev.length && prev[prev.length - 1]?.role === "assistant" && !prev[prev.length - 1]?.content
          ? prev.slice(0, -1)
          : prev
      );
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center px-4 py-2.5">
        <ModelPicker value={model} onChange={setModel} />
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4">
        <div className="mx-auto w-full max-w-3xl space-y-5 py-4">
          {messages.length === 0 ? (
            <div className="flex min-h-[55vh] flex-col items-center justify-center gap-3 text-center">
              <span className="text-4xl" aria-hidden>🦥</span>
              <p className="text-xl font-semibold text-primary">Good to see you</p>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i} className={cn("flex gap-3", m.role === "user" ? "justify-end" : "justify-start")}>
                {m.role === "assistant" ? (
                  <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
                    <Bot className="size-4" aria-hidden />
                  </div>
                ) : null}
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap",
                    m.role === "user" ? "bg-primary text-primary-foreground" : "bg-surface-2 text-ink"
                  )}
                >
                  {m.content || (isStreaming && m.role === "assistant" ? "…" : "")}
                </div>
                {m.role === "user" ? (
                  <div className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-ink-soft">
                    <User className="size-4" aria-hidden />
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="px-4 pb-4">
        <div className="mx-auto w-full max-w-3xl">
          {error ? (
            <div className="mb-2 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
              {error}
            </div>
          ) : null}
          <div className="flex items-end gap-2 rounded-2xl border border-input bg-background p-2 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Ask anything…"
              rows={1}
              className="max-h-40 min-h-[36px] flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
              disabled={isStreaming}
            />
            {isStreaming ? (
              <Button type="button" variant="outline" size="icon" onClick={stop} aria-label="Stop">
                <Square className="size-4" />
              </Button>
            ) : (
              <Button type="button" size="icon" onClick={send} disabled={!input.trim()} aria-label="Send">
                <Send className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function appendDelta(prev: ChatMessage[], delta: string): ChatMessage[] {
  const next = [...prev];
  const last = next[next.length - 1];
  if (last?.role === "assistant") next[next.length - 1] = { ...last, content: last.content + delta };
  return next;
}
