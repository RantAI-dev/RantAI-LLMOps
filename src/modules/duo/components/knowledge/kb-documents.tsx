"use client";

import { AlertCircle, Check, FileUp, RotateCcw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConfirmButton, fmtAgo, fmtBytes, fmtInt, Note, Pill, Spinner } from "@/modules/duo/components/duo-ui";
import {
  checkFile,
  DOC_ACCEPT,
  DOC_TYPES_TEXT,
  docPath,
  docState,
  docWordsOnly,
  KB_KINDS,
  kbPath,
  num,
  plural,
  sentence,
  uploadDocument,
  type KbDoc,
  type KbStatus,
} from "@/modules/duo/components/knowledge/kb-api";
import type { PassageTarget } from "@/modules/duo/components/knowledge/kb-passages";
import { gw, GwError } from "@/modules/duo/lib/gw";

// ---------- uploads ----------

type UpState = "wait" | "up" | "done" | "bad" | "cancelled";
type Up = { id: number; file: File; kb: string; state: UpState; p: number; msg: string; retry: boolean; abort?: () => void };

/**
 * Files go up one at a time, so each has its own progress and can be cancelled on its own. The queue lives in a ref:
 * when the page is left, a file that is going up still finishes and its outcome is said in a notice.
 */
function useUploads(onAdded: (kb: string) => void) {
  const q = useRef<Up[]>([]);
  const seq = useRef(0);
  const busy = useRef(false);
  const alive = useRef(true);
  const added = useRef(onAdded);
  // What is drawn: a copy of the queue, taken whenever it changes (its rows are changed in place).
  const [list, setList] = useState<Up[]>([]);
  const draw = useCallback(() => {
    if (alive.current) setList([...q.current]);
  }, []);
  useEffect(() => {
    added.current = onAdded;
  }, [onAdded]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // Files still waiting are not sent once the page is gone.
      const left = q.current.filter((u) => u.state === "wait");
      if (left.length) toast(`${plural(left.length, "file")} not sent because the page was left`);
      for (const u of left) u.state = "cancelled";
    };
  }, []);

  const send = useCallback(
    async (u: Up) => {
      u.state = "up";
      u.p = 0;
      draw();
      try {
        const req = uploadDocument(u.kb, u.file, (p) => {
          u.p = p;
          draw();
        });
        u.abort = req.abort;
        const r = await req.done;
        const doc = (r.documents ?? [])[0];
        const ref = (r.refused ?? [])[0];
        if (ref) {
          u.state = "bad";
          u.retry = false;
          u.msg = sentence(ref.reason) || "The service did not accept this file.";
        } else if (doc?.duplicate) {
          u.state = "done";
          u.msg = "Already in this knowledge base; nothing was added.";
        } else if (doc) {
          u.state = "done";
          u.msg = "Added. It is being read now; follow it in the list below.";
        } else {
          u.state = "bad";
          u.msg = "Nothing was added. Try again.";
        }
      } catch (e) {
        if ((e as Error)?.name === "AbortError") {
          u.state = "cancelled";
          u.msg = "Cancelled. Nothing was added.";
        } else {
          u.state = "bad";
          u.retry = !(e instanceof GwError && e.status === 413);
          u.msg = e instanceof Error ? e.message : String(e);
        }
      }
      u.abort = undefined;
      if (!alive.current) {
        if (u.state === "done") toast(`“${u.file.name}” was added to your knowledge base`);
        if (u.state === "bad") toast.error(`“${u.file.name}” was not added. ${u.msg}`);
      } else if (u.state === "done") {
        added.current(u.kb);
        setTimeout(() => {
          q.current = q.current.filter((x) => x !== u);
          draw();
        }, 6000);
      }
      draw();
    },
    [draw]
  );

  // One file after another until none is waiting.
  const pump = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    for (let u = q.current.find((x) => x.state === "wait"); u; u = q.current.find((x) => x.state === "wait")) {
      await send(u);
    }
    busy.current = false;
  }, [send]);

  const add = useCallback(
    (kb: string, files: File[], maxMb: number) => {
      for (const file of files) {
        const reason = checkFile(file, maxMb);
        q.current.push({ id: ++seq.current, file, kb, state: reason ? "bad" : "wait", p: 0, msg: reason ?? "", retry: !reason });
      }
      draw();
      void pump();
    },
    [draw, pump]
  );
  const cancel = useCallback(
    (u: Up) => {
      if (u.abort) u.abort();
      else if (u.state === "wait") {
        u.state = "cancelled";
        u.msg = "Cancelled before it was sent.";
      }
      draw();
    },
    [draw]
  );
  const retry = useCallback(
    (u: Up) => {
      u.state = "wait";
      u.p = 0;
      u.msg = "";
      draw();
      void pump();
    },
    [draw, pump]
  );
  const dismiss = useCallback(
    (u: Up) => {
      q.current = q.current.filter((x) => x !== u);
      draw();
    },
    [draw]
  );
  /** A deleted base: its uploads stop. */
  const dropBase = useCallback(
    (kb: string) => {
      for (const u of q.current.filter((x) => x.kb === kb)) u.abort?.();
      q.current = q.current.filter((x) => x.kb !== kb || x.state === "up");
      draw();
    },
    [draw]
  );
  return { list, add, cancel, retry, dismiss, dropBase };
}
export type Uploads = ReturnType<typeof useUploads>;
export { useUploads };

const upStage = (u: Up) =>
  u.state === "wait" ? "Waiting its turn" : u.state === "up" ? (u.p >= 1 ? "Sent. Waiting for the service to accept it…" : `Uploading ${Math.round(u.p * 100)}%`) : u.msg;

function UploadRow({ u, uploads }: { u: Up; uploads: Uploads }) {
  const live = u.state === "wait" || u.state === "up";
  const pct = Math.round(u.p * 100);
  return (
    <li className={cn("rounded-md border px-3 py-2", u.state === "bad" ? "border-danger-border bg-danger-soft" : "border-hairline bg-background")}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={u.file.name}>
          {u.file.name}
        </span>
        <span className="shrink-0 text-xs text-ink-faint">{fmtBytes(u.file.size)}</span>
        {live ? (
          <Button size="xs" variant="ghost" onClick={() => uploads.cancel(u)} aria-label={`Cancel uploading ${u.file.name}`}>
            Cancel
          </Button>
        ) : null}
        {(u.state === "bad" && u.retry) || u.state === "cancelled" ? (
          <Button size="xs" variant="ghost" onClick={() => uploads.retry(u)} aria-label={`Try ${u.file.name} again`}>
            Try again
          </Button>
        ) : null}
        {!live ? (
          <Button size="icon-xs" variant="ghost" onClick={() => uploads.dismiss(u)} aria-label={`Dismiss ${u.file.name}`} title="Dismiss">
            <X />
          </Button>
        ) : null}
      </div>
      <p className={cn("mt-0.5 flex items-start gap-1 text-xs", u.state === "bad" ? "text-danger" : "text-ink-soft")}>
        {u.state === "bad" ? <AlertCircle className="mt-px size-3.5 shrink-0" aria-hidden /> : null}
        {u.state === "done" ? <Check className="mt-px size-3.5 shrink-0 text-success" aria-hidden /> : null}
        {u.state === "up" ? <Spinner className="size-3.5" /> : null}
        <span className="break-words">{upStage(u)}</span>
      </p>
      {live ? (
        <div
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2"
          role="progressbar"
          aria-label={`Upload progress of ${u.file.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
        >
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </li>
  );
}

/** The drop box and the files going up. Files dropped anywhere on the tab count too (see KbDocuments). */
function DropZone({ onFiles, maxMb, over }: { onFiles: (f: File[]) => void; maxMb: number; over: boolean }) {
  const input = useRef<HTMLInputElement | null>(null);
  return (
    <div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/25",
          over ? "border-primary bg-primary-soft" : "border-hairline bg-surface-2 hover:border-primary/60"
        )}
      >
        <FileUp className="size-5 text-ink-faint" aria-hidden />
        <span>
          <strong>Drop files here</strong> or <span className="text-primary underline">choose files</span>
        </span>
        <span className="text-xs text-ink-faint">
          {DOC_TYPES_TEXT}, up to {maxMb} MB each.
        </span>
      </button>
      <input
        ref={input}
        type="file"
        multiple
        accept={DOC_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose files to add"
        data-testid="kb-file-input"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ---------- the note about searching by meaning ----------

export function EmbedNote({ kb, status, docs, onReindexed }: { kb: string; status: KbStatus; docs: KbDoc[]; onReindexed: (queued: number) => void }) {
  const [busy, setBusy] = useState(false);
  const e = status.embedder;
  if (!e) return null;
  if (e.reachable === false)
    return (
      <Note tone="warn">
        Searching by meaning is unavailable right now, so searches use words only.{" "}
        <span className="text-xs">The embedding service{e.model ? ` (${e.model})` : ""} is not answering.</span>
      </Note>
    );
  const missing = docs.filter(docWordsOnly).length;
  if (!missing) return null;
  return (
    <Note tone="info" className="flex flex-wrap items-center gap-2">
      <span>{plural(missing, "document")} can only be searched by words so far.</span>
      <Button
        size="xs"
        variant="outline"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const r = await gw<{ queued?: number }>(`${kbPath(kb)}/reindex`, { method: "POST" });
            toast(num(r?.queued) ? `Indexing ${plural(num(r?.queued), "document")} for meaning` : "Everything is already indexed");
            onReindexed(num(r?.queued));
          } catch (err) {
            toast.error(`Indexing did not start. ${err instanceof Error ? err.message : ""}`);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner className="size-3" /> : null}
        Index for meaning
      </Button>
    </Note>
  );
}

// ---------- the documents tab ----------

export function KbDocuments({
  kb,
  status,
  docs,
  uploads,
  onChanged,
  onReindexed,
  onOpen,
}: {
  kb: string;
  status: KbStatus;
  docs: KbDoc[];
  uploads: Uploads;
  /** Something changed (deleted, read again, reindexed): reload the list and the counts. */
  onChanged: () => void;
  /** "Index for meaning" started, with the number of documents queued: keep refreshing until every passage has its vector. */
  onReindexed: (queued: number) => void;
  onOpen: (t: PassageTarget) => void;
}) {
  const maxMb = num(status.limits?.max_upload_mb) || 50;
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const add = (files: File[]) => uploads.add(kb, files, maxMb);
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  const hasEmbedder = !!status.embedder;
  const mine = uploads.list.filter((u) => u.kb === kb);

  async function reread(d: KbDoc) {
    try {
      await gw(`${docPath(kb, d.id)}/reingest`, { method: "POST" });
      toast(`Reading “${d.title || d.filename}” again`);
      onChanged();
    } catch (e) {
      toast.error(`The document was not read again. ${e instanceof Error ? e.message : ""}`);
    }
  }
  async function remove(d: KbDoc) {
    try {
      await gw(docPath(kb, d.id), { method: "DELETE" });
      toast("Document deleted");
      onChanged();
    } catch (e) {
      toast.error(`The document was not deleted. ${e instanceof Error ? e.message : ""}`);
    }
  }

  return (
    <div
      className="space-y-3"
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (hasFiles(e)) e.preventDefault();
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      }}
      onDrop={(e) => {
        depth.current = 0;
        setOver(false);
        if (!hasFiles(e)) return;
        e.preventDefault();
        const f = [...(e.dataTransfer?.files ?? [])];
        if (f.length) add(f);
      }}
    >
      <DropZone onFiles={add} maxMb={maxMb} over={over} />
      <ul aria-live="polite" aria-label="Files being added" className="space-y-1.5">
        {mine.map((u) => (
          <UploadRow key={u.id} u={u} uploads={uploads} />
        ))}
      </ul>
      <EmbedNote kb={kb} status={status} docs={docs} onReindexed={onReindexed} />
      {!docs.length ? (
        <p className="rounded-md border border-dashed border-hairline px-4 py-8 text-center text-sm text-ink-soft">
          No documents yet. Add some with the box above; each one is read into short passages you can search.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-hairline">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">Documents in this knowledge base</caption>
            <thead className="bg-surface-2 text-left text-xs text-ink-soft">
              <tr>
                <th className="px-3 py-2 font-medium">Document</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Size</th>
                <th className="px-3 py-2 font-medium">Passages</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => {
                const st = docState(d, hasEmbedder);
                const name = d.title || d.filename || "Untitled";
                return (
                  <tr key={d.id} className="border-t border-hairline align-top">
                    <td className="max-w-[18rem] px-3 py-2">
                      <p className="truncate font-medium" title={name}>
                        {name}
                      </p>
                      <p className="truncate text-xs text-ink-faint" title={d.filename}>
                        {d.filename ?? ""}
                        {num(d.pages) ? ` · ${plural(num(d.pages), "page")}` : ""} · added {fmtAgo(d.created_at)}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <Pill>{KB_KINDS[d.kind ?? ""] ?? d.kind ?? "–"}</Pill>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fmtBytes(d.bytes)}</td>
                    <td className="px-3 py-2 tabular-nums">{d.status === "ready" || num(d.n_chunks) ? fmtInt(num(d.n_chunks)) : "–"}</td>
                    <td className="max-w-[16rem] px-3 py-2">
                      <Pill tone={st.tone} title={st.label === "Words only" ? "Found by words; searching by meaning needs indexing" : undefined}>
                        {st.busy ? <Spinner className="size-3" /> : null}
                        {st.label}
                      </Pill>
                      {d.error ? <p className="mt-1 text-xs break-words text-danger">{sentence(d.error)}</p> : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={d.status !== "ready"}
                          onClick={() => onOpen({ docId: d.id, title: name, pages: d.pages })}
                          aria-label={`Passages of ${name}`}
                        >
                          Passages
                        </Button>
                        <ConfirmButton
                          variant="ghost"
                          disabled={st.busy}
                          confirmLabel="Read again?"
                          title={`Read “${name}” again: its passages are replaced`}
                          onConfirm={() => reread(d)}
                        >
                          <RotateCcw aria-hidden />
                          <span className="sr-only">Read {name} again</span>
                        </ConfirmButton>
                        <ConfirmButton variant="ghost" confirmLabel="Delete?" title={`Delete “${name}” and its ${fmtInt(num(d.n_chunks))} passages`} onConfirm={() => remove(d)}>
                          <Trash2 aria-hidden />
                          <span className="sr-only">Delete {name}</span>
                        </ConfirmButton>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
