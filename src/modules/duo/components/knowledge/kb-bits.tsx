"use client";

import { useCallback, useState } from "react";

import { ErrorState } from "@/components/ui/error-state";
import { GwErrorState } from "@/modules/duo/components/duo-ui";
import { highlightParts, isProxyUnconfigured, stripHeadings } from "@/modules/duo/components/knowledge/kb-api";
import type { GwError } from "@/modules/duo/lib/gw";

/** A load error inside Knowledge: a store that stopped answering says so, instead of "Duo is not configured". */
export function KbErrorState({ error, onRetry, what }: { error: GwError; onRetry?: () => void; what: string }) {
  if (error.status === 503 && !isProxyUnconfigured(error))
    return <ErrorState title={`Could not load ${what}`} description={`The knowledge store is not available right now. ${error.message}`} onRetry={onRetry} />;
  return <GwErrorState error={error} onRetry={onRetry} what={what} />;
}

/** Passage text with the query's words marked. Never rendered as HTML. */
export function Highlight({ text, query }: { text: unknown; query?: string }) {
  const clean = stripHeadings(text);
  if (!query) return <>{clean}</>;
  return (
    <>
      {highlightParts(clean, query).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-warning-soft px-0.5 text-foreground">
            {p.t}
          </mark>
        ) : (
          <span key={i}>{p.t}</span>
        )
      )}
    </>
  );
}

/** A small preference kept in this browser (the chosen base, the search mode). Storage may be blocked: then it is not kept. */
export function useStored<T extends string>(key: string, initial: T, valid?: (v: string) => v is T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const v = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
      if (v !== null && (!valid || valid(v))) return v as T;
    } catch {
      /* blocked storage */
    }
    return initial;
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        window.localStorage.setItem(key, v);
      } catch {
        /* blocked storage */
      }
    },
    [key]
  );
  return [value, set];
}
