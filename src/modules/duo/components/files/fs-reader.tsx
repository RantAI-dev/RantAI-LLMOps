"use client";

import { Download, FileText, Pencil, Undo2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  ConfirmButton,
  fmtAgo,
  fmtInt,
  GwErrorState,
  KV,
  Loading,
  Panel,
  Pill,
  Segmented,
  StaleNote,
  arr,
  rec,
  str,
} from "@/modules/duo/components/duo-ui";
import {
  FS_LEVELS,
  OP_LABEL,
  isEditable,
  isRemovable,
  q,
  saveText,
  toDiff,
  type FsLevel,
  type FsRead,
} from "@/modules/duo/components/files/fs-lib";
import { gw, GwError, useGw } from "@/modules/duo/lib/gw";
import { MarkdownPreview } from "@/modules/notes/markdown-preview";

const KIND_LABEL: Record<string, string> = {
  root: "Everything",
  directory: "Folder",
  base: "Knowledge base",
  document: "Document",
  passage: "Passage",
  memory: "Memory file",
  skill: "Skill",
  session: "Saved chat",
};

/** One item read at a level, with what can be done to it. */
export function FsReader({
  uri,
  level,
  doc,
  error,
  loading,
  title,
  onLevel,
  onRetry,
  onOpen,
  onEdit,
  onDeleted,
  onChanged,
}: {
  uri: string;
  level: FsLevel;
  doc: FsRead | null;
  error: GwError | null;
  loading: boolean;
  title: string;
  onLevel: (l: FsLevel) => void;
  onRetry: () => void;
  /** Open another URI (a section, the document of a passage, a changed memory file). */
  onOpen: (uri: string, level?: FsLevel) => void;
  onEdit: (doc: FsRead) => void;
  onDeleted: (uri: string) => void;
  /** Something shown here changed (a memory change was undone): read the folder and this item again. */
  onChanged?: () => void;
}) {
  const [opening, setOpening] = useState(false);
  if (error && !doc) return <GwErrorState error={error} onRetry={onRetry} what="this item" />;
  if (!doc) return <Panel><Loading label="Reading…" /></Panel>;

  const kind = doc.kind;
  const meta = doc.meta;
  // Documents keep HTML comments (page markers) in their full text; they are not for reading.
  const body = level === "2" && kind === "document" ? doc.content.replace(/<!--[\s\S]*?-->/g, "") : doc.content;
  const sections = arr<{ heading?: string; uri?: string }>(meta.sections).filter((s) => typeof s.uri === "string");
  const tags = arr<string>(meta.tags).filter((t) => typeof t === "string");
  const sources = arr<string>(meta.sources).filter((t) => typeof t === "string");

  async function remove() {
    try {
      await gw(`/v1/fs/rm?uri=${q(uri)}`, { method: "DELETE" });
      toast.success("Deleted", { description: kind === "memory" ? "The change is listed under Memory › Recent changes and can be undone there." : undefined });
      onDeleted(uri);
    } catch (err) {
      toast.error("The file could not be deleted", { description: err instanceof GwError ? err.message : undefined });
    }
  }

  async function edit() {
    setOpening(true);
    try {
      // The editor always works on the full text, whatever level is being read.
      const full = level === "2" ? doc! : await gw<unknown>(`/v1/fs/read?uri=${q(uri)}&level=2`).then((d) => ({ ...doc!, content: str(rec(d).content, "") }));
      onEdit(full);
    } catch (err) {
      toast.error("This file could not be opened for editing", { description: err instanceof GwError ? err.message : undefined });
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="grid gap-3">
      <Panel
        title={<span className="break-words">{title}</span>}
        actions={
          <>
            <Pill>{KIND_LABEL[kind] ?? kind}</Pill>
            <Segmented label="How much to read" value={level} onChange={onLevel} options={FS_LEVELS.map((l) => ({ id: l.id, label: l.label, hint: l.hint }))} />
            {isEditable(kind) ? (
              <Button type="button" size="sm" variant="outline" onClick={() => void edit()} disabled={opening}>
                <Pencil aria-hidden /> Edit
              </Button>
            ) : null}
            {isRemovable(kind) ? (
              <ConfirmButton onConfirm={remove} confirmLabel="Click again to delete" variant="outline" title={`Delete ${title}`}>
                Delete
              </ConfirmButton>
            ) : null}
          </>
        }
      >
        <p className="mb-3 text-xs text-ink-faint">
          <code className="break-all">{doc.uri}</code>
        </p>
        <div aria-busy={loading} className={loading ? "opacity-60 transition-opacity" : undefined}>
          {body.trim() ? (
            <div className="max-h-[65dvh] overflow-auto break-words text-sm leading-6">
              <MarkdownPreview source={body} />
            </div>
          ) : (
            <p className="text-sm text-ink-soft">There is nothing to show at this level.</p>
          )}
        </div>
        <MetaRows kind={kind} meta={meta} tags={tags} sources={sources} onOpen={onOpen} />
        {sections.length && level !== "0" ? (
          <div className="mt-4 border-t border-hairline pt-3">
            <h3 className="mb-1.5 text-xs font-semibold text-ink-soft">Sections</h3>
            <ul className="grid gap-1">
              {sections.slice(0, 60).map((s) => (
                <li key={s.uri}>
                  <button type="button" className="text-left text-sm text-primary hover:underline focus-visible:underline focus-visible:outline-none" onClick={() => onOpen(s.uri!, "2")}>
                    {s.heading || "Untitled section"}
                  </button>
                </li>
              ))}
            </ul>
            {sections.length > 60 ? <p className="mt-1 text-xs text-ink-faint">The first 60 of {sections.length} sections.</p> : null}
          </div>
        ) : null}
      </Panel>
      {uri === "nafs://memory" ? <MemoryChanges onOpen={onOpen} onUndone={onChanged} /> : null}
      {uri === "nafs://sessions" ? <SaveChats onSaved={() => onOpen(uri)} /> : null}
      {kind === "base" ? <Compile uri={uri} title={str(meta.title, "knowledge")} /> : null}
    </div>
  );
}

function MetaRows({
  kind,
  meta,
  tags,
  sources,
  onOpen,
}: {
  kind: string;
  meta: Record<string, unknown>;
  tags: string[];
  sources: string[];
  onOpen: (uri: string, level?: FsLevel) => void;
}) {
  const rows: Array<[string, ReactNode] | false> = [
    typeof meta.updated === "string" && ["Last changed", fmtAgo(meta.updated)],
    typeof meta.documents === "number" && ["Documents", fmtInt(meta.documents)],
    typeof meta.passages === "number" && ["Passages", fmtInt(meta.passages)],
    typeof meta.messages === "number" && ["Messages", fmtInt(meta.messages)],
    typeof meta.items === "number" && kind === "directory" && ["Items", fmtInt(meta.items)],
    typeof meta.page === "number" && ["Page", fmtInt(meta.page)],
    tags.length > 0 && [
      "Tags",
      <span key="t" className="flex flex-wrap gap-1">
        {tags.map((t) => (
          <Pill key={t}>{t}</Pill>
        ))}
      </span>,
    ],
    sources.length > 0 && ["Learned from", <span key="s" className="break-all">{sources.slice(0, 5).join(", ")}{sources.length > 5 ? ` and ${sources.length - 5} more` : ""}</span>],
    typeof meta.document === "string" && [
      "From",
      <button key="d" type="button" className="text-left text-primary hover:underline" onClick={() => onOpen(meta.document as string, "1")}>
        {str(meta.title, "the document")}
      </button>,
    ],
  ];
  if (!rows.some(Boolean)) return null;
  return <KV className="mt-4 border-t border-hairline pt-3" rows={rows} />;
}

/** Every change to the memory files, and why, with undo (`/v1/memory/diff`). */
function MemoryChanges({ onOpen, onUndone }: { onOpen: (uri: string, level?: FsLevel) => void; onUndone?: () => void }) {
  const { data, error, loading, reload } = useGw<unknown>("/v1/memory/diff?limit=30");
  const [busy, setBusy] = useState<string | null>(null);
  const rows = toDiff(data);

  async function undo(id: string) {
    setBusy(id);
    try {
      await gw(`/v1/memory/diff/${encodeURIComponent(id)}/undo`, { method: "POST" });
      toast.success("Undone");
      onUndone?.();
      await reload();
    } catch (err) {
      toast.error("This change could not be undone", { description: err instanceof GwError ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title="Recent changes" info="Every change to your memory files, and why. Undo puts a file back as it was before that change.">
      {error && !data ? (
        <GwErrorState error={error} onRetry={() => void reload(false)} what="the memory changes" />
      ) : loading && !data ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="text-sm text-ink-soft">No changes yet.</p>
      ) : (
        <ul className="grid gap-2">
          {error ? (
            <li>
              <StaleNote error={error} onRetry={() => void reload(false)} />
            </li>
          ) : null}
          {rows.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <Pill tone={x.op === "delete" ? "bad" : x.op === "add" ? "good" : x.op === "skip" ? "neutral" : "info"}>{OP_LABEL[x.op] ?? x.op}</Pill>
              {x.uri && x.op !== "delete" ? (
                <button type="button" className="min-w-0 text-left break-words text-primary hover:underline" onClick={() => onOpen(x.uri, "2")}>
                  {x.title || x.uri}
                </button>
              ) : (
                <span className="min-w-0 break-words">{x.title || x.uri || "A memory file"}</span>
              )}
              <span className="text-xs text-ink-faint">
                {x.reason ? `${x.reason} · ` : ""}
                {fmtAgo(x.at)}
              </span>
              {x.undone ? (
                <span className="text-xs text-ink-faint">(undone)</span>
              ) : x.op !== "skip" ? (
                <Button type="button" size="xs" variant="ghost" className="ml-auto" disabled={busy !== null} onClick={() => void undo(x.id)} aria-label={`Undo: ${OP_LABEL[x.op] ?? x.op} ${x.title || x.uri}`}>
                  <Undo2 aria-hidden /> {busy === x.id ? "Undoing…" : "Undo"}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

type Conv = { conversation_id?: string; id?: string; title?: string; messages?: number; updated_at?: string };

/** Save a chat as a file: the transcript is kept, and what was said about the person becomes memory files. */
function SaveChats({ onSaved }: { onSaved: () => void }) {
  const { data, error, loading, reload } = useGw<unknown>("/v1/conversations");
  const [busy, setBusy] = useState<string | null>(null);
  const list = (Array.isArray(data) ? data : arr(rec(data).conversations ?? rec(data).items)) as Conv[];
  const convs = list.filter((c) => typeof (c.conversation_id ?? c.id) === "string").slice(0, 12);

  async function save(id: string) {
    setBusy(id);
    try {
      const r = rec(await gw(`/v1/sessions/${encodeURIComponent(id)}/commit`, { method: "POST" }));
      const learned = toDiff(r.diff).filter((d) => d.op !== "skip").length;
      toast.success(learned ? `Saved. ${learned} memory file${learned === 1 ? "" : "s"} added or changed.` : "Saved. Nothing new to remember.");
      onSaved();
    } catch (err) {
      toast.error("The chat could not be saved", { description: err instanceof GwError ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title="Save a chat as a file" info="The chat is written out in full, and what you said about yourself is kept as memory files you can read and edit. Shared rooms are never saved.">
      {error && !data ? (
        <GwErrorState error={error} onRetry={() => void reload(false)} what="your chats" />
      ) : loading && !data ? (
        <Loading />
      ) : convs.length === 0 ? (
        <p className="text-sm text-ink-soft">No chats yet.</p>
      ) : (
        <ul className="grid gap-2">
          {error ? (
            <li>
              <StaleNote error={error} onRetry={() => void reload(false)} />
            </li>
          ) : null}
          {convs.map((c) => {
            const id = (c.conversation_id ?? c.id) as string;
            return (
              <li key={id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <span className="min-w-0 flex-1 break-words">{str(c.title, "Untitled chat")}</span>
                <span className="text-xs text-ink-faint">
                  {typeof c.messages === "number" ? `${c.messages} message${c.messages === 1 ? "" : "s"} · ` : ""}
                  {fmtAgo(c.updated_at)}
                </span>
                <Button type="button" size="xs" variant="outline" disabled={busy !== null} onClick={() => void save(id)} aria-label={`Save “${str(c.title, "Untitled chat")}” as a file`}>
                  <FileText aria-hidden /> {busy === id ? "Saving…" : "Save as file"}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

const COMPILE_TO = [
  { id: "wiki", label: "Wiki" },
  { id: "graph", label: "Graph" },
  { id: "report", label: "Report" },
] as const;

/** Turn a knowledge base into linked Markdown pages, with no model (`POST /v1/compile`). */
function Compile({ uri, title }: { uri: string; title: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function run(to: string) {
    setBusy(to);
    setDone(null);
    try {
      const c = rec(await gw("/v1/compile", { body: { from: uri, to } }));
      const files = arr<{ path?: string; content?: string }>(c.files);
      const all = files.map((f) => `<!-- ${str(f.path, "page")} -->\n${str(f.content, "")}`).join("\n\n");
      saveText(all, `${title.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "") || "knowledge"}-${to}.md`);
      setDone(`${files.length} page${files.length === 1 ? "" : "s"} compiled and downloaded.`);
    } catch (err) {
      toast.error("The knowledge base could not be compiled", { description: err instanceof GwError ? err.message : undefined });
    } finally {
      setBusy(null);
    }
  }
  return (
    <Panel title="Compile" info="Turn this knowledge base into linked Markdown pages, with no model: a wiki, a map of its terms, or one report.">
      <div className="flex flex-wrap items-center gap-2">
        {COMPILE_TO.map((t) => (
          <Button key={t.id} type="button" size="sm" variant={t.id === "wiki" ? "default" : "outline"} disabled={busy !== null} onClick={() => void run(t.id)}>
            <Download aria-hidden /> {busy === t.id ? "Compiling…" : t.label}
          </Button>
        ))}
        <span className="text-sm text-ink-soft" role="status" aria-live="polite">
          {done}
        </span>
      </div>
    </Panel>
  );
}
