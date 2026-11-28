"use client";

import { Brain, Eraser, Sparkles, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { ConfirmButton, GwErrorState, Loading, Note, Panel, Pill, Spinner, StaleNote, arr, fmtAgo, rec } from "@/modules/duo/components/duo-ui";
import { gw, GwError, useGw } from "@/modules/duo/lib/gw";

type Episode = { id: string; created_at?: string; kind?: string; conversation_id?: string | null; text: string; access_count?: number };

const KIND: Record<string, string> = { turn: "From a chat", window: "Several turns of a chat", note: "You asked to keep this" };
const LIMIT = 200;
const MAX_NOTE = 4000;
/** The word typed to confirm forgetting everything. */
const CONFIRM_WORD = "forget";

const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`;

function summary(enabled: boolean, count: number): string {
  if (!enabled) return "Remembering earlier conversations is turned off on this service. Notes you add here are still kept.";
  if (count)
    return `${plural(count, "note")} from earlier conversations ${count === 1 ? "is" : "are"} kept. A question that says “my”, “last time” or “you said” is answered with the notes that match it. Private chats and rooms are never remembered.`;
  return "Nothing is remembered yet. Each finished turn of a saved chat becomes a short note; private chats and rooms are never remembered. Start a message with “Remember that …” to keep something on purpose, or add a note here.";
}

function toEpisodes(items: unknown): Episode[] {
  return arr(items)
    .map((x) => rec(x))
    .filter((x) => typeof x.id === "string" && typeof x.text === "string")
    .map((x) => x as unknown as Episode)
    .sort((a, b) => (Date.parse(b.created_at ?? "") || 0) - (Date.parse(a.created_at ?? "") || 0));
}

/** The memory of earlier conversations (`/v1/memory`): read every note, add one, forget one or all, merge repeats. */
export function MemoryNotes() {
  const { data, error, loading, reload, setData } = useGw<unknown>(`/v1/memory?limit=${LIMIT}`);
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [tidying, setTidying] = useState(false);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [askAll, setAskAll] = useState(false);
  const inputId = useId();

  if (error && !data) return <GwErrorState error={error} onRetry={() => void reload(false)} what="the memory" />;
  if (loading && !data) return <Loading label="Loading the memory…" />;

  const m = rec(data);
  const enabled = m.enabled !== false;
  const items = toEpisodes(m.items);
  const count = typeof m.count === "number" ? m.count : items.length;

  async function add(note: string, quiet = false) {
    await gw("/v1/memory", { body: { text: note } });
    if (!quiet) toast.success("Remembered");
    await reload();
  }

  async function submit() {
    const note = text.trim();
    if (!note) return;
    if (note.length > MAX_NOTE) {
      setAddError(`A note holds at most ${MAX_NOTE.toLocaleString()} characters.`);
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      await add(note);
      setText("");
    } catch (err) {
      setAddError(err instanceof GwError ? err.message : "The note could not be saved.");
    } finally {
      setAdding(false);
    }
  }

  // Forgetting asks once more first: the list only holds a 240-character preview of each note, without its chat, so
  // a forgotten note could not be put back as it was.
  async function forget(e: Episode) {
    setForgetting(e.id);
    try {
      await gw(`/v1/memory/${encodeURIComponent(e.id)}`, { method: "DELETE" });
      // Shown gone at once; the list is read again to keep the count right.
      setData((prev: unknown) => {
        const r = rec(prev);
        return { ...r, items: arr(r.items).filter((x) => rec(x).id !== e.id), count: Math.max(0, (typeof r.count === "number" ? r.count : 1) - 1) };
      });
      toast.success("Forgotten");
      void reload();
    } catch (err) {
      toast.error("The note could not be forgotten", { description: err instanceof GwError ? err.message : undefined });
    } finally {
      setForgetting(null);
    }
  }

  async function tidy() {
    setTidying(true);
    try {
      const r = rec(await gw("/v1/memory/tidy", { method: "POST" }));
      const merged = typeof r.merged === "number" ? r.merged : 0;
      toast.success(merged ? `${plural(merged, "repeated note")} merged` : "No repeated notes found");
      await reload();
    } catch (err) {
      toast.error("The notes could not be merged", { description: err instanceof GwError ? err.message : undefined });
    } finally {
      setTidying(false);
    }
  }

  return (
    <div className="grid gap-3">
      <Panel
        title="Remembered notes"
        info="Short notes the assistant keeps from earlier conversations, and notes you add yourself. They are read back when a question refers to something said before."
        actions={
          items.length ? (
            <>
              <Button type="button" size="sm" variant="outline" onClick={() => void tidy()} disabled={tidying}>
                {tidying ? <Spinner className="size-3.5" /> : <Sparkles aria-hidden />} {tidying ? "Merging…" : "Merge repeated notes"}
              </Button>
              <Button type="button" size="sm" variant="destructive" onClick={() => setAskAll(true)}>
                <Eraser aria-hidden /> Forget everything
              </Button>
            </>
          ) : null
        }
      >
        <p className="text-sm text-ink-soft">{summary(enabled, count)}</p>
        {error ? <StaleNote error={error} onRetry={() => void reload(false)} /> : null}
        <form
          className="mt-3 flex flex-wrap items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor={inputId} className="sr-only">
            A note to remember
          </label>
          <Input
            id={inputId}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (addError) setAddError(null);
            }}
            maxLength={MAX_NOTE}
            placeholder="Something to remember, for example: my server listens on port 8443"
            className="min-w-0 flex-1 basis-64"
            aria-invalid={addError ? true : undefined}
            aria-describedby={addError ? `${inputId}-err` : undefined}
          />
          <Button type="submit" size="sm" disabled={adding || !text.trim()} className="h-8">
            {adding ? <Spinner className="size-3.5 text-primary-foreground" /> : <Brain aria-hidden />} {adding ? "Saving…" : "Remember"}
          </Button>
        </form>
        {addError ? (
          <p id={`${inputId}-err`} role="alert" className="mt-1.5 text-xs text-danger">
            {addError}
          </p>
        ) : null}
      </Panel>

      {items.length === 0 ? (
        <EmptyState icon={Brain} title="Nothing is remembered yet" description="Notes appear here as chats finish, or when you add one above." />
      ) : (
        <Panel bodyClassName="p-0">
          <ul className="divide-y divide-hairline" aria-label="Notes, newest first" aria-busy={loading}>
            {items.map((e) => (
              <li key={e.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-faint">
                    <Pill tone={e.kind === "note" ? "info" : "neutral"}>{KIND[e.kind ?? ""] ?? "Note"}</Pill>
                    <span>{fmtAgo(e.created_at)}</span>
                    {typeof e.access_count === "number" && e.access_count > 0 ? <span>used {plural(e.access_count, "time")}</span> : null}
                  </p>
                  <p className="mt-1 text-sm break-words whitespace-pre-wrap">{e.text}</p>
                </div>
                <ConfirmButton
                  size="xs"
                  variant="ghost"
                  onConfirm={() => forget(e)}
                  disabled={forgetting !== null}
                  confirmLabel="Click again to forget"
                  title="The note is deleted. This cannot be undone."
                  ariaLabel={`Forget this note: ${e.text.slice(0, 60)}`}
                >
                  <Trash2 aria-hidden /> Forget
                </ConfirmButton>
              </li>
            ))}
          </ul>
          {count > items.length ? <p className="border-t border-hairline px-4 py-2 text-xs text-ink-faint">Showing the newest {items.length.toLocaleString()} of {count.toLocaleString()}.</p> : null}
        </Panel>
      )}

      <ForgetAllDialog
        open={askAll}
        count={count}
        onClose={() => setAskAll(false)}
        onDone={async () => {
          setAskAll(false);
          await reload();
        }}
      />
    </div>
  );
}

/** Forgetting everything cannot be undone, so the person types a word to confirm. */
function ForgetAllDialog({ open, count, onClose, onDone }: { open: boolean; count: number; onClose: () => void; onDone: () => Promise<void> }) {
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const ready = word.trim().toLowerCase() === CONFIRM_WORD;

  const close = () => {
    if (busy) return;
    setWord("");
    setError(null);
    onClose();
  };

  async function go() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const r = rec(await gw("/v1/memory", { method: "DELETE" }));
      const n = typeof r.forgotten === "number" ? r.forgotten : null;
      toast.success(n !== null ? `Everything was forgotten (${plural(n, "note")})` : "Everything was forgotten");
      setWord("");
      await onDone();
    } catch (err) {
      setError(err instanceof GwError ? err.message : "The memory could not be cleared.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (!o ? close() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void go();
          }}
        >
          <DialogHeader>
            <DialogTitle>Forget everything?</DialogTitle>
            <DialogDescription>
              All {plural(count, "note")} from earlier conversations will be deleted. Your chats themselves are kept, and so are memory files and skills. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <label htmlFor={id} className="grid gap-1 text-sm">
            <span>
              Type <strong>{CONFIRM_WORD}</strong> to confirm
            </span>
            <Input id={id} value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" autoFocus />
          </label>
          {error ? <Note tone="bad">{error}</Note> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!ready || busy}>
              {busy ? <Spinner className="size-3.5" /> : null}
              {busy ? "Forgetting…" : "Forget everything"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
