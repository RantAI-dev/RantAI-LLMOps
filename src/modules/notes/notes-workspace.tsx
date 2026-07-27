"use client";

import { useCallback, useRef, useState } from "react";
import { Loader2, NotebookPen, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoTip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { NoteEditor } from "@/modules/notes/note-editor";
import { useNotes } from "@/modules/notes/use-notes";

const DISCARD_PROMPT = "Discard unsaved changes?";

export function NotesWorkspace() {
  const { notes, loading, selectedId, setSelectedId, createNote, deleteNote, busy } = useNotes();
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  // The editor owns its draft (keyed by id); it reports dirtiness up so we can
  // warn before a switch discards unsaved edits.
  const dirtyRef = useRef(false);
  const handleDirty = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  /** Change selection, guarding unsaved edits in the current note. */
  const selectNote = (id: string) => {
    if (id === selectedId) return;
    if (dirtyRef.current && !window.confirm(DISCARD_PROMPT)) return;
    dirtyRef.current = false;
    setSelectedId(id);
  };

  const submitNew = async () => {
    const title = newTitle.trim();
    if (!title || busy) return;
    if (dirtyRef.current && !window.confirm(DISCARD_PROMPT)) return;
    const note = await createNote(title);
    if (!note) return; // failed — keep the typed title + input open
    dirtyRef.current = false;
    setSelectedId(note.id);
    setNewTitle("");
    setCreating(false);
  };

  const handleDelete = (id: string, title: string) => {
    if (!window.confirm(`Delete note "${title}"?`)) return;
    if (id === selectedId) dirtyRef.current = false; // its draft is going away with it
    void deleteNote(id);
  };

  return (
    <div className="flex min-h-0 w-full flex-1 gap-4">
      {/* Note list */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-hairline pr-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <h1 className="truncate text-xl font-semibold leading-8 tracking-tight text-primary">Notes</h1>
            <InfoTip label="About notes">
              Markdown notes saved server-side, so they stay with your team rather than one browser. Use
              them to capture prompts, findings, and run details alongside your models.
            </InfoTip>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> New
          </Button>
        </div>

        {creating ? (
          <div className="mb-2 flex items-center gap-1.5">
            <Input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitNew();
                if (e.key === "Escape") {
                  setCreating(false);
                  setNewTitle("");
                }
              }}
              placeholder="Note title…"
              className="h-8 text-sm"
              disabled={busy}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 shrink-0"
              onClick={() => {
                setCreating(false);
                setNewTitle("");
              }}
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-2 px-1 py-6 text-sm text-ink-soft">
              <Loader2 className="size-4 animate-spin" /> Loading…
            </div>
          ) : notes.length === 0 ? (
            <p className="px-1 py-6 text-sm text-ink-soft">
              No notes yet. Click <strong>New</strong> to create one.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {notes.map((note) => {
                const active = note.id === selectedId;
                return (
                  <li key={note.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => selectNote(note.id)}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                        active
                          ? "bg-surface-2 font-medium text-primary-light"
                          : "text-primary hover:bg-surface-2"
                      )}
                    >
                      <NotebookPen className="size-3.5 shrink-0 text-ink-faint" />
                      <span className="min-w-0 flex-1 truncate">{note.title}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${note.title}`}
                      disabled={busy}
                      onClick={() => handleDelete(note.id, note.title)}
                      className="shrink-0 rounded p-1 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-danger disabled:opacity-40"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      {/* Editor */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {selected ? (
          <NoteEditor
            key={selected.id}
            noteId={selected.id}
            title={selected.title}
            onDirtyChange={handleDirty}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-ink-soft">
            <NotebookPen className="size-8 text-ink-faint" />
            <p className="text-sm">
              {loading ? "Loading notes…" : "Select a note on the left, or create a new one."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
