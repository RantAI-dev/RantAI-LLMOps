"use client";

import { Brain, ChevronDown, Send, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { DuoMode, DuoTrace } from "@/lib/duo";
import { cn } from "@/lib/utils";

type Turn = { role: "user"; content: string } | { role: "assistant"; content: string; trace: DuoTrace };

const MODES: Array<{ id: DuoMode; label: string; hint: string }> = [
  { id: "auto", label: "Auto", hint: "System 1 drafts; the gate decides whether System 2 takes over" },
  { id: "fast", label: "Fast", hint: "System 1 only" },
  { id: "slow", label: "Careful", hint: "System 2 always" },
];

const ASSURANCE: Record<string, string> = {
  checked: "Checked",
  verified: "Checked",
  consensus: "Cross-checked",
  unverified: "Not checked",
};

const secs = (ms: number | null) => (ms === null ? "–" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

export function DuoPlayground() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<DuoMode>("auto");
  const [lambda, setLambda] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/duo/chat")
      .then((r) => r.json())
      .then((j: { configured?: boolean }) => setConfigured(Boolean(j.configured)))
      .catch(() => setConfigured(false));
  }, []);
  // A block body: an effect may only return a cleanup function. Chrome's scrollIntoView now returns a Promise, and
  // returning it made React call the Promise as a cleanup when the Duo tabs hid this panel ("i is not a function").
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [turns, busy]);

  async function send() {
    const q = input.trim();
    if (!q || busy) return;
    const next: Turn[] = [...turns, { role: "user", content: q }];
    setTurns(next);
    setInput("");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/duo/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map((t) => ({ role: t.role, content: t.content })),
          mode,
          ...(lambda !== null ? { lambda } : {}),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      const trace = j as DuoTrace;
      setTurns([...next, { role: "assistant", content: trace.answer, trace }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setTurns(turns);
      setInput(q);
    } finally {
      setBusy(false);
    }
  }

  if (configured === false) {
    return (
      <div className="rounded-lg border border-hairline bg-card p-6 text-sm text-muted-foreground">
        The Duo gateway is not configured. Set <code>DUO_GATEWAY_URL</code> and <code>DUO_GATEWAY_TOKEN</code> on the
        frontend to a Rantai-Aql gateway (see docs/RENCANA-DUO.md).
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-hairline bg-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-hairline px-4 py-3">
        <div className="mr-auto">
          <div className="text-sm font-semibold">Duo: System 1 + System 2</div>
          <div className="text-xs text-muted-foreground">A quick model answers first; a reasoning model steps in when it is worth the wait.</div>
        </div>
        <div className="flex rounded-md border border-hairline p-0.5" role="radiogroup" aria-label="Mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              title={m.hint}
              onClick={() => setMode(m.id)}
              className={cn("rounded px-2.5 py-1 text-xs", mode === m.id ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
            >
              {m.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground" title="Price of waiting relative to an error. Lower = escalate more often.">
          Speed–care λ
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={lambda ?? 0.2}
            onChange={(e) => setLambda(Number(e.target.value))}
            aria-label="lambda"
            disabled={mode !== "auto"}
          />
          <span className="w-16 tabular-nums">{lambda === null ? "default" : lambda.toFixed(2)}</span>
        </label>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ask something easy and something hard. Each answer shows which system answered, how it was checked, and
            where the time went.
          </p>
        )}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="ml-auto max-w-[80%] whitespace-pre-wrap rounded-lg bg-muted px-3 py-2 text-sm">
              {t.content}
            </div>
          ) : (
            <AnswerCard key={i} answer={t.content} trace={t.trace} />
          )
        )}
        {busy && <p className="text-xs text-muted-foreground">Thinking… System 2 answers can take a minute or more.</p>}
        <div ref={endRef} />
      </div>

      {error && <div className="border-t border-hairline px-4 py-2 text-xs text-destructive">{error}</div>}
      <div className="flex gap-2 border-t border-hairline p-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Ask a question…"
          rows={2}
          maxLength={8000}
          aria-label="Question"
        />
        <Button onClick={() => void send()} disabled={busy || !input.trim() || configured === null} aria-label="Send">
          <Send className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function AnswerCard({ answer, trace }: { answer: string; trace: DuoTrace }) {
  const [open, setOpen] = useState(false);
  const slow = trace.mode === "slow";
  const total = trace.stages.reduce((a, s) => a + s.ms, 0) || 1;
  return (
    <div className="max-w-[90%] space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium", slow ? "bg-violet-500/15 text-violet-700 dark:text-violet-300" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300")}>
          {slow ? <Brain className="size-3" /> : <Zap className="size-3" />}
          {slow ? "System 2" : "System 1"}
        </span>
        <span className="rounded-full bg-muted px-2 py-0.5">{ASSURANCE[trace.assurance] ?? trace.assurance}</span>
        <span className="text-muted-foreground">{secs(trace.usage.wallMs)}</span>
        {trace.degraded && <span className="text-amber-600">degraded</span>}
      </div>
      <div className="whitespace-pre-wrap rounded-lg border border-hairline px-3 py-2 text-sm">{answer || "(empty answer)"}</div>
      {trace.uncertaintyNotice && <div className="text-xs text-amber-700 dark:text-amber-300">{trace.uncertaintyNotice}</div>}
      <button type="button" onClick={() => setOpen(!open)} className="inline-flex items-center gap-1 text-xs text-muted-foreground" aria-expanded={open}>
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} /> Trace
      </button>
      {open && (
        <div className="space-y-3 rounded-lg bg-muted/50 p-3 text-xs" data-testid="duo-trace">
          <div>
            <div className="mb-1 font-medium">Gate</div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
              <span>Escalated: {trace.gate.escalate === null ? "–" : trace.gate.escalate ? "yes" : "no"}</span>
              <span>Rule: {trace.gate.rule ?? "–"}</span>
              <span>λ: {trace.gate.lambda ?? "–"}</span>
              <span>Agreement: {pct(trace.gate.agreement)}</span>
              <span>Est. error S1: {pct(trace.gate.errorFast)}</span>
              <span>Est. error S2: {pct(trace.gate.errorSlow)}</span>
              <span>Domain: {trace.domain ?? "–"}</span>
              <span>Checkable: {trace.gate.verifiable === null ? "–" : trace.gate.verifiable ? "yes" : "no"}</span>
            </div>
            {trace.gate.explanation && <p className="mt-1 text-muted-foreground">{trace.gate.explanation}</p>}
          </div>
          {trace.verifier && (
            <div>
              <span className="font-medium">Checker: </span>
              {trace.verifier.name}, {trace.verifier.passed === null ? "no verdict" : trace.verifier.passed ? "passed" : "failed"}
              {trace.verifier.score !== null && `, score ${trace.verifier.score}`}, {secs(trace.verifier.ms)}
            </div>
          )}
          <div>
            <div className="mb-1 font-medium">Where the time went</div>
            {trace.stages.map((s, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-24 shrink-0">{s.stage}</span>
                <div className="h-2 flex-1 rounded bg-background">
                  <div className="h-2 rounded bg-primary/60" style={{ width: `${Math.max(2, (s.ms / total) * 100)}%` }} />
                </div>
                <span className="w-16 shrink-0 text-right tabular-nums">{secs(s.ms)}</span>
                <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">{s.tokens ?? "–"} tok</span>
              </div>
            ))}
            <p className="mt-1 text-muted-foreground">
              {trace.usage.modelCalls ?? "–"} model calls, {trace.usage.verifierCalls ?? "–"} checker calls,{" "}
              {trace.usage.reasoningTokens ?? 0} reasoning tokens, first token {secs(trace.usage.ttftMs)}
            </p>
          </div>
          {trace.reasoning && (
            <details>
              <summary className="cursor-pointer font-medium">System 2 reasoning</summary>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap text-muted-foreground">{trace.reasoning}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
