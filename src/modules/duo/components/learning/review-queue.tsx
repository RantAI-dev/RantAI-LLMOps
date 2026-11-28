"use client";

import { Check, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GwErrorState, Loading, Panel, Pill, arr, fmtAgo, str } from "@/modules/duo/components/duo-ui";
import { domainName } from "@/modules/duo/components/quality/shared";
import { GwError, gw, useGw } from "@/modules/duo/lib/gw";
import { MarkdownPreview } from "@/modules/notes/markdown-preview";

type Item = Record<string, unknown>;
type Pending = { approved: boolean; timer: ReturnType<typeof setTimeout> };

// The reviewer's name is remembered in this browser (a convenience; the gateway records it with each review).
const REVIEWER_KEY = "duo.reviewer";
const REVIEWER_EVENT = "duo-reviewer";
const readReviewer = () => {
  try {
    return window.localStorage.getItem(REVIEWER_KEY) ?? "";
  } catch {
    return "";
  }
};
const writeReviewer = (v: string) => {
  try {
    window.localStorage.setItem(REVIEWER_KEY, v);
  } catch {
    /* private mode: the name is not remembered */
  }
  window.dispatchEvent(new Event(REVIEWER_EVENT));
};
const subscribeReviewer = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener(REVIEWER_EVENT, cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener(REVIEWER_EVENT, cb);
  };
};
/** The proxy path of the gateway's review endpoint (the same one `gw` posts to). */
const reviewUrl = (id: string) => `/api/duo/gw/v1/tazkiya/review/${encodeURIComponent(id)}`;
const errMsg = (e: unknown) => (e instanceof GwError ? e.message : e instanceof Error ? e.message : String(e));

/**
 * Agreed ("Cross-checked") answers from real chats wait here until a person approves them for training. A decision leaves
 * the list at once and is sent after a short pause, so Undo can take it back; if sending fails the answer comes back.
 */
export function ReviewQueue({ undoMs = 5000, onReviewed }: { undoMs?: number; onReviewed?: () => void }) {
  const { data, error, loading, reload } = useGw<Item[]>("/v1/tazkiya/review?limit=30", { refreshMs: 30_000 });
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const reviewer = useSyncExternalStore(subscribeReviewer, readReviewer, () => "");
  const pending = useRef(new Map<string, Pending>());
  const reviewerRef = useRef(reviewer);
  useEffect(() => {
    reviewerRef.current = reviewer;
  }, [reviewer]);

  const unhide = useCallback((id: string) => {
    setHidden((h) => {
      const n = new Set(h);
      n.delete(id);
      return n;
    });
  }, []);

  const send = useCallback(
    async (id: string, approved: boolean) => {
      pending.current.delete(id);
      try {
        await gw(`/v1/tazkiya/review/${encodeURIComponent(id)}`, { method: "POST", body: { approved, reviewer: reviewerRef.current.trim() || "operator" } });
        onReviewed?.();
      } catch (e) {
        unhide(id);
        toast.error(approved ? "The approval was not saved" : "The rejection was not saved", { description: `${errMsg(e)} The answer is back in the list.` });
      }
    },
    [onReviewed, unhide]
  );

  // Leaving the page (another page of the app, closing the tab, or the tab going to the background where it may be
  // discarded) sends what is still waiting for its Undo window, so no decision is lost. `keepalive` lets the request
  // finish after the page is gone.
  useEffect(() => {
    const map = pending.current;
    const flush = () => {
      for (const [id, p] of map) {
        clearTimeout(p.timer);
        try {
          void fetch(reviewUrl(id), {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ approved: p.approved, reviewer: reviewerRef.current.trim() || "operator" }),
            keepalive: true,
            cache: "no-store",
          }).catch(() => undefined);
        } catch {
          /* the page is going away; nothing more can be done */
        }
      }
      map.clear();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
  }, []);

  function decide(id: string, approved: boolean) {
    if (pending.current.has(id)) return;
    setHidden((h) => new Set(h).add(id));
    const timer = setTimeout(() => void send(id, approved), undoMs);
    pending.current.set(id, { approved, timer });
    toast(approved ? "Approved for learning" : "Rejected", {
      id: `review-${id}`,
      duration: undoMs,
      action: {
        label: "Undo",
        onClick: () => {
          const p = pending.current.get(id);
          if (!p) return;
          clearTimeout(p.timer);
          pending.current.delete(id);
          unhide(id);
        },
      },
    });
  }

  const items = arr(data).filter((x) => typeof x.reply_id === "string" && !hidden.has(String(x.reply_id)));

  return (
    <Panel
      title="Waiting for review"
      info="Answers that several independent attempts agreed on (Cross-checked) are a good sign, not a proof. They are used for learning only after a person approves them. Approve an answer only if it is correct and safe to learn from."
      actions={
        <div className="flex items-center gap-2">
          <label htmlFor="duo-reviewer" className="text-xs text-ink-soft">
            Reviewing as
          </label>
          <Input
            id="duo-reviewer"
            value={reviewer}
            placeholder="operator"
            maxLength={60}
            onChange={(e) => writeReviewer(e.target.value)}
            className="h-7 w-36 text-xs"
          />
        </div>
      }
      bodyClassName="p-0"
    >
      {error && !data ? (
        <div className="p-4">
          <GwErrorState error={error} onRetry={() => reload(false)} what="the review queue" />
        </div>
      ) : loading && !data ? (
        <div className="px-4">
          <Loading />
        </div>
      ) : items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-ink-soft">Nothing to review. Agreed answers from real chats appear here.</p>
      ) : (
        <ul className="divide-y divide-hairline" aria-label="Answers waiting for review">
          {items.map((x) => {
            const id = String(x.reply_id);
            const q = str(x.question, "");
            return (
              <li key={id} className="space-y-2 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Pill>{domainName(x.domain)}</Pill>
                  <Pill tone="info" title="Several independent attempts agreed on this answer">
                    Cross-checked
                  </Pill>
                  {x.mode ? <Pill tone={x.mode === "slow" ? "slow" : "fast"}>{x.mode === "slow" ? "Thorough answer" : "Quick answer"}</Pill> : null}
                  <span className="text-ink-faint">{fmtAgo(x.created_at)}</span>
                  <div className="ml-auto flex gap-1.5">
                    <Button size="xs" onClick={() => decide(id, true)} aria-label={`Approve: ${q.slice(0, 60) || "answer"}`}>
                      <Check /> Approve
                    </Button>
                    <Button size="xs" variant="outline" onClick={() => decide(id, false)} aria-label={`Reject: ${q.slice(0, 60) || "answer"}`}>
                      <X /> Reject
                    </Button>
                  </div>
                </div>
                <p className="text-sm font-medium text-primary">{q || <span className="font-normal italic text-ink-faint">(question not stored)</span>}</p>
                <div className="max-h-72 overflow-y-auto rounded-md border border-hairline bg-background p-3 text-[13px]">
                  <MarkdownPreview source={str(x.answer, "")} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
