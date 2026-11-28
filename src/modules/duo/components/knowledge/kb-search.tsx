"use client";

import { BookOpen, MessageSquare, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { fmtMs, fmtNum, fmtPct, Note, Segmented, Spinner } from "@/modules/duo/components/duo-ui";
import { askHref, kbPath, num, plural, sentence, type KbHit, type KbSearchResult, type SearchMode } from "@/modules/duo/components/knowledge/kb-api";
import { Highlight, useStored } from "@/modules/duo/components/knowledge/kb-bits";
import type { PassageTarget } from "@/modules/duo/components/knowledge/kb-passages";
import { gw, GwError } from "@/modules/duo/lib/gw";

const MODES: Array<{ id: SearchMode; label: string; hint: string }> = [
  { id: "hybrid", label: "Meaning and words", hint: "Passages close in meaning and passages with your words, ranked together" },
  { id: "vector", label: "Meaning", hint: "Passages close in meaning, even without your words" },
  { id: "lexical", label: "Words", hint: "Passages that contain your words" },
];
const HOW: Record<string, string> = { hybrid: "by meaning and words", vector: "by meaning", lexical: "by words" };
const isMode = (v: string): v is SearchMode => v === "hybrid" || v === "vector" || v === "lexical";

type State = { q: string; busy: boolean; result: KbSearchResult | null; error: string | null };

/** Search one base by words, by meaning or both. Results appear as you type (from three letters, after a pause). */
export function KbSearch({ kb, canMeaning, readyDocs, docPages, onOpen }: {
  kb: string;
  /** False when the base has no embedder: meaning modes would fall back to words anyway. */
  canMeaning: boolean;
  readyDocs: number;
  docPages: (docId: string) => number | null | undefined;
  onOpen: (t: PassageTarget) => void;
}) {
  const [mode, setMode] = useStored<SearchMode>("duo.kb.searchMode", "hybrid", isMode);
  const [text, setText] = useState("");
  const [s, setS] = useState<State>({ q: "", busy: false, result: null, error: null });
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function run(raw: string, m: SearchMode = mode) {
    const q = raw.trim();
    const my = ++seq.current;
    if (!q) {
      setS({ q: "", busy: false, result: null, error: null });
      return;
    }
    setS((p) => ({ ...p, q, busy: true, error: null }));
    try {
      const r = await gw<KbSearchResult>(`${kbPath(kb)}/search`, { body: { query: q, k: 8, mode: m } });
      if (my === seq.current) setS({ q, busy: false, result: r ?? {}, error: null });
    } catch (e) {
      if (my === seq.current) setS({ q, busy: false, result: null, error: e instanceof GwError ? e.message : String(e) });
    }
  }

  useEffect(
    () => () => {
      seq.current++;
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const hits: KbHit[] = s.result?.results ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="How to search"
          value={mode}
          options={MODES}
          onChange={(m) => {
            setMode(m);
            if (s.q) void run(s.q, m);
          }}
        />
        {!canMeaning ? <span className="text-xs text-ink-faint">Searching by meaning is not set up on this server: words are used.</span> : null}
      </div>
      <form
        role="search"
        autoComplete="off"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (timer.current) clearTimeout(timer.current);
          void run(text);
        }}
      >
        <Input
          type="search"
          value={text}
          maxLength={2000}
          placeholder="Search this knowledge base"
          aria-label="Search this knowledge base"
          onChange={(e) => {
            const v = e.target.value;
            setText(v);
            if (timer.current) clearTimeout(timer.current);
            if (!v.trim()) void run("");
            else if (v.trim().length >= 3) timer.current = setTimeout(() => void run(v), 400);
          }}
        />
        <Button type="submit" disabled={!text.trim()}>
          <Search aria-hidden />
          Search
        </Button>
      </form>
      {!readyDocs ? (
        <p className="text-xs text-ink-faint">No document is ready yet: add documents, and search once they are read.</p>
      ) : !s.q ? (
        <p className="text-xs text-ink-faint">Results appear as you type. Open a result to read it in its document.</p>
      ) : null}

      <div aria-live="polite" className={cn("space-y-2", s.busy && hits.length ? "opacity-60" : "")}>
        {s.busy && !hits.length ? (
          <p className="flex items-center gap-2 text-sm text-ink-soft" role="status">
            <Spinner /> Searching…
          </p>
        ) : null}
        {s.error ? <Note tone="bad">The search did not finish. {s.error}</Note> : null}
        {s.result && s.result.fallback ? <Note tone="warn">Searched by words only: {sentence(s.result.fallback)}</Note> : null}
        {s.result && !s.busy && !hits.length ? (
          <p className="rounded-md border border-dashed border-hairline px-4 py-6 text-center text-sm text-ink-soft" role="status">
            No passage matches. Try other words, or check that the documents are ready.
          </p>
        ) : null}
        {hits.length ? (
          <p className="text-xs text-ink-faint" role="status">
            {plural(hits.length, "passage")} {HOW[s.result?.mode ?? ""] ?? ""} · {fmtMs(num(s.result?.took_ms))}
          </p>
        ) : null}
        {hits.map((h, i) => (
          <article key={`${h.chunk_id}-${i}`} className="rounded-md border border-hairline bg-background p-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
              <button
                type="button"
                className="min-w-0 text-left font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none"
                onClick={() => onOpen({ docId: h.doc_id, title: h.doc_title, pages: docPages(h.doc_id), ord: h.ord ?? null, chunkId: h.chunk_id, query: s.q })}
              >
                <span className="break-words">{h.doc_title || "Document"}</span>
                {h.heading ? <span className="font-normal text-ink-faint"> › {h.heading}</span> : null}
                {num(h.page) ? <span className="font-normal text-ink-faint"> · page {num(h.page)}</span> : null}
              </button>
              <span className="ml-auto flex flex-wrap gap-x-2 text-xs text-ink-faint">
                {typeof h.vector_score === "number" ? <span>{fmtPct(h.vector_score)} match</span> : null}
                {typeof h.vector_score === "number" && typeof h.lexical_score === "number" ? (
                  <span>close in meaning and has your words</span>
                ) : typeof h.lexical_score === "number" ? (
                  <span>has your words</span>
                ) : null}
                <span title="Ranking score">score {fmtNum(h.score, 3)}</span>
              </span>
            </div>
            <p className="mt-1.5 line-clamp-6 text-sm leading-6 break-words whitespace-pre-wrap text-foreground">
              <Highlight text={h.text} query={s.q} />
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpen({ docId: h.doc_id, title: h.doc_title, pages: docPages(h.doc_id), ord: h.ord ?? null, chunkId: h.chunk_id, query: s.q })}
              >
                <BookOpen aria-hidden />
                Open in the document
              </Button>
              <Link href={askHref(kb)} className={buttonVariants({ size: "sm", variant: "ghost" })}>
                <MessageSquare aria-hidden />
                Ask about this
              </Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
