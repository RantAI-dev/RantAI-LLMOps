"use client";

import { Loader2, MessageSquare, Send } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MockBanner } from "@/components/ui/mock-banner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { datasetUi, panelClassName } from "@/modules/datasets/constants/dataset-ui";
import { useDatasets } from "@/modules/datasets/hooks/use-datasets";
import type { RagQueryResult } from "@/modules/datasets/types";
import { cn } from "@/lib/utils";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: RagQueryResult[];
};

const SUGGESTED_QUERIES = [
  "How do I initiate a stock transfer?",
  "What is the cycle count procedure?",
  "How long do I have to inspect inbound shipments?",
];

export function InteractRagPage() {
  const { ragKnowledgeBases, queryRag } = useDatasets();
  const readyBases = useMemo(
    () => ragKnowledgeBases.filter((kb) => kb.rag?.indexStatus === "Ready"),
    [ragKnowledgeBases]
  );

  const [kbId, setKbId] = useState(readyBases[0]?.id ?? "");
  const [llmModel, setLlmModel] = useState("meta-llama/Llama-3.1-8B-Instruct");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Ask questions about your indexed documents. Answers are grounded in your knowledge base — supporting sources appear on the right.",
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [lastSources, setLastSources] = useState<RagQueryResult[]>([]);
  const msgIdRef = useRef(0);

  const selectedKb = readyBases.find((kb) => kb.id === kbId) ?? readyBases[0];

  const sendQuery = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !selectedKb) return;

    const userMsg: ChatMessage = {
      id: `u-${msgIdRef.current++}`,
      role: "user",
      content: trimmed,
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);

    await new Promise((r) => setTimeout(r, 900));

    const result = queryRag(selectedKb.id, trimmed);
    const sources = result?.results ?? [];
    setLastSources(sources);

    setMessages((prev) => [
      ...prev,
      {
        id: `a-${msgIdRef.current++}`,
        role: "assistant",
        content:
          result?.answer ??
          "This knowledge base is not ready yet. Upload documents and run indexing from the Documents page.",
        sources,
      },
    ]);
    setLoading(false);
  };

  if (readyBases.length === 0) {
    return (
      <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
        <MessageSquare className="size-10 text-primary/60" />
        <h2 className={cn("mt-4 text-primary", datasetUi.title)}>Document Q&amp;A</h2>
        <p className={cn("mt-2 max-w-md", datasetUi.subheading)}>
          No indexed knowledge bases yet. Add documents and complete indexing before asking questions
          here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="border-b border-hairline pb-4">
        <h1 className={cn("text-primary", datasetUi.title)}>Interact</h1>
        <p className={cn("mt-1", datasetUi.subheading)}>
          Ask questions and get answers grounded in your team&apos;s documents.
        </p>
      </div>

      <MockBanner>
        RAG belum didukung backend Transformer Lab (Documents hanya penyimpanan file).
        Jawaban dan skor sumber di bawah masih contoh (mock).
      </MockBanner>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex min-h-[480px] flex-col rounded-lg border border-border">
          <div className="flex flex-wrap gap-3 border-b border-border bg-surface p-3">
            <Field label="Knowledge Base">
              <Select
                items={readyBases.map((kb) => ({ value: kb.id, label: kb.name }))}
                value={selectedKb?.id ?? kbId}
                onValueChange={(next) => next && setKbId(next)}
              >
                <SelectTrigger aria-label="Knowledge Base" className="min-w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {readyBases.map((kb) => (
                    <SelectItem key={kb.id} value={kb.id}>
                      {kb.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Answer model">
              <Select
                items={[
                  { value: "meta-llama/Llama-3.1-8B-Instruct", label: "Llama 3.1 8B Instruct" },
                  { value: "Qwen/Qwen2.5-7B-Instruct", label: "Qwen 2.5 7B Instruct" },
                  { value: "gpt-4o-mini", label: "GPT-4o-mini (API)" },
                ]}
                value={llmModel}
                onValueChange={(next) => next && setLlmModel(next)}
              >
                <SelectTrigger aria-label="Answer model" className="min-w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="meta-llama/Llama-3.1-8B-Instruct">Llama 3.1 8B Instruct</SelectItem>
                  <SelectItem value="Qwen/Qwen2.5-7B-Instruct">Qwen 2.5 7B Instruct</SelectItem>
                  <SelectItem value="gpt-4o-mini">GPT-4o-mini (API)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn(
                  "max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed",
                  msg.role === "user"
                    ? "ml-auto bg-primary text-white"
                    : "bg-surface-2 text-ink"
                )}
              >
                {msg.content}
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-[13px] text-ink-soft">
                <Loader2 className="size-4 animate-spin" />
                Finding relevant sources…
              </div>
            )}
          </div>

          <div className="border-t border-border p-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {SUGGESTED_QUERIES.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => sendQuery(q)}
                  className="rounded-full border border-border bg-white px-2.5 py-1 text-[11px] text-ink-soft hover:border-primary/40 hover:text-primary"
                >
                  {q}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void sendQuery(input);
              }}
            >
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question about your documents…"
                disabled={loading}
              />
              <Button type="submit" disabled={loading || !input.trim()}>
                <Send className="size-4" />
              </Button>
            </form>
          </div>
        </div>

        <aside className={cn(panelClassName, "flex flex-col p-4")}>
          <h2 className="text-sm font-semibold text-primary">Sources</h2>
          <p className="mt-1 text-xs text-ink-soft">
            Passages retrieved with {selectedKb?.rag?.indexConfig.embeddingModelName ?? "your embedding model"}
          </p>
          <div className="mt-3 flex-1 space-y-3 overflow-y-auto">
            {lastSources.length === 0 ? (
              <p className="text-[13px] text-ink-soft">Ask a question to see which sources were used.</p>
            ) : (
              lastSources.map(({ chunk, score }) => (
                <div key={chunk.id} className="rounded-md border border-border bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-medium text-primary">{chunk.documentName}</p>
                    <span className="text-[11px] tabular-nums text-success-bright">
                      {(score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-ink">{chunk.content}</p>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] font-medium text-ink-soft">{label}</span>
      {children}
    </label>
  );
}
