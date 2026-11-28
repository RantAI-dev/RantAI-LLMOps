"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { Loading, Note } from "@/modules/duo/components/duo-ui";
import { docPath, num, plural, type KbChunk } from "@/modules/duo/components/knowledge/kb-api";
import { Highlight } from "@/modules/duo/components/knowledge/kb-bits";
import { gw, GwError } from "@/modules/duo/lib/gw";

const PAGE = 50;

/** What to open: a document, and optionally one passage in it (from a search hit or a graph fact). */
export type PassageTarget = { docId: string; title?: string; pages?: number | null; ord?: number | null; chunkId?: string | null; query?: string };

type Chunks = { chunks?: KbChunk[]; total?: number; offset?: number };

/**
 * A document's passages, 50 at a time, in a side panel. Given a passage (its place `ord`, or only its id), the page
 * that holds it opens with that passage marked and scrolled into view, so a hit is read in its context.
 */
export function KbPassages({ kb, target, onClose }: { kb: string; target: PassageTarget | null; onClose: () => void }) {
  return (
    <Sheet open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-2xl">
        {target ? <PassageBody key={`${target.docId}:${target.chunkId ?? target.ord ?? ""}`} kb={kb} target={target} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function PassageBody({ kb, target }: { kb: string; target: PassageTarget }) {
  const [offset, setOffset] = useState<number | null>(null);
  const [first, setFirst] = useState<number | null>(null);
  const [ord, setOrd] = useState<number | null>(target.ord ?? null);
  const [data, setData] = useState<Chunks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hitRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const base = `${docPath(kb, target.docId)}/chunks`;

  // First page: the one that holds the passage. Only its id known: look for its place (up to 2,000 passages).
  useEffect(() => {
    let alive = true;
    (async () => {
      let o = target.ord;
      if ((o === null || o === undefined) && target.chunkId) {
        for (let off = 0; off < 2000; off += 500) {
          const s = await gw<Chunks>(`${base}?offset=${off}&limit=500`);
          const list = s?.chunks ?? [];
          const c = list.find((x) => x.id === target.chunkId);
          if (c) {
            o = num(c.ord);
            break;
          }
          if (!list.length || off + list.length >= num(s?.total)) break;
        }
      }
      if (!alive) return;
      const start = o !== null && o !== undefined ? Math.floor(o / PAGE) * PAGE : 0;
      setOrd(o ?? null);
      setFirst(start);
      setOffset(start);
    })().catch((e: unknown) => {
      if (alive) {
        setFirst(0);
        setOffset(0);
        setError(e instanceof GwError ? e.message : String(e));
      }
    });
    return () => {
      alive = false;
    };
  }, [base, target.ord, target.chunkId]);

  useEffect(() => {
    if (offset === null) return;
    let alive = true;
    gw<Chunks>(`${base}?offset=${offset}&limit=${PAGE}`)
      .then((r) => alive && setData(r ?? {}))
      .catch((e: unknown) => alive && setError(e instanceof GwError ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [base, offset]);

  const chunks = data?.chunks ?? [];
  const total = num(data?.total);
  const isHit = (c: KbChunk) => (ord !== null && num(c.ord) === ord) || (!!target.chunkId && c.id === target.chunkId);
  const wanted = ord !== null || !!target.chunkId;
  const found = chunks.some(isHit);

  useEffect(() => {
    if (!data) return;
    if (hitRef.current) {
      hitRef.current.scrollIntoView?.({ block: "center" });
      hitRef.current.focus({ preventScroll: true });
    } else listRef.current?.scrollTo?.(0, 0);
  }, [data]);

  const from = offset ?? 0;
  const go = (o: number) => {
    setData(null);
    setError(null);
    setOffset(o);
  };
  return (
    <>
      <SheetHeader className="border-b border-hairline pr-12">
        <SheetTitle className="break-words">{target.title || "Document"}</SheetTitle>
        <SheetDescription>
          {data
            ? `${plural(total, "passage")}${num(target.pages) ? ` from ${plural(num(target.pages), "page")}` : ""}${chunks.length ? `; showing ${from + 1}–${from + chunks.length}` : ""}.`
            : "Loading the passages…"}
        </SheetDescription>
      </SheetHeader>
      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
        {error ? <Note tone="bad">The passages could not be loaded. {error}</Note> : null}
        {!data && !error ? <Loading label="Loading the passages…" /> : null}
        {data && wanted && !found && offset === first ? (
          <Note tone="warn">The passage could not be found; the document may have been read again since.</Note>
        ) : null}
        {data && !chunks.length ? <p className="py-6 text-center text-sm text-ink-soft">This document has no passages.</p> : null}
        {chunks.map((c) => {
          const hit = isHit(c);
          return (
            <div
              key={c.id}
              ref={hit ? hitRef : undefined}
              tabIndex={hit ? -1 : undefined}
              className={cn(
                "rounded-md border p-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                hit ? "border-primary bg-primary-soft" : "border-hairline bg-background"
              )}
            >
              <p className="mb-1 text-xs text-ink-faint">
                #{num(c.ord) + 1}
                {c.heading ? ` · ${c.heading}` : ""}
                {num(c.page) ? ` · page ${num(c.page)}` : ""}
                {hit ? <strong className="text-primary"> · the passage you opened</strong> : null}
              </p>
              <p className="text-sm leading-6 break-words whitespace-pre-wrap">
                <Highlight text={c.text} query={hit ? target.query : undefined} />
              </p>
            </div>
          );
        })}
      </div>
      {data && (from > 0 || from + chunks.length < total) ? (
        <div className="flex items-center justify-between gap-2 border-t border-hairline p-3">
          <Button size="sm" variant="outline" disabled={from === 0} onClick={() => go(Math.max(0, from - PAGE))}>
            Previous
          </Button>
          <span className="text-xs text-ink-faint">
            Page {Math.floor(from / PAGE) + 1} of {Math.max(1, Math.ceil(total / PAGE))}
          </span>
          <Button size="sm" variant="outline" disabled={from + chunks.length >= total} onClick={() => go(from + PAGE)}>
            Next {PAGE}
          </Button>
        </div>
      ) : null}
    </>
  );
}
