"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

export type NoteSummary = { id: string; title: string };

/**
 * Drives the Notes workspace: the list of notes plus create/delete. Each note's
 * content is loaded/saved by the editor itself (keyed by id), so this hook only
 * owns the list + selection.
 */
export function useNotes() {
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notes", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { notes: [] }))
      .then((data: { notes?: NoteSummary[] }) => {
        if (cancelled) return;
        const list = data.notes ?? [];
        setNotes(list);
        // Default the selection to the first note once loaded.
        setSelectedId((cur) => (cur && list.some((n) => n.id === cur) ? cur : list[0]?.id ?? null));
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Returns the created (or existing) note so the caller can select it AFTER its
  // own unsaved-changes guard; null on failure. Selection is the workspace's job.
  const createNote = useCallback(async (title: string): Promise<NoteSummary | null> => {
    setBusy(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const data = (await res.json()) as { note?: NoteSummary; existed?: boolean; error?: string };
      if (!res.ok || !data.note) throw new Error(data.error || "Failed to create note");
      const note = data.note;
      setNotes((prev) =>
        prev.some((n) => n.id === note.id)
          ? prev
          : [...prev, note].sort((a, b) => a.title.localeCompare(b.title))
      );
      // A different title can slugify onto an existing note — tell the user we
      // opened that one instead of silently pretending it's new.
      if (data.existed) toast.info("A note with that name already exists — opened it.");
      return note;
    } catch (err) {
      toast.error((err as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const deleteNote = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        const res = await fetch(`/api/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || "Failed to delete note");
        }
        // Two top-level setStates (no setState inside another's updater): drop the
        // row, and if the deleted note was selected, clear the selection. Both use
        // functional updaters so neither reads stale `notes` from the closure; the
        // default-selection logic then picks the next note.
        setNotes((prev) => prev.filter((n) => n.id !== id));
        setSelectedId((cur) => (cur === id ? null : cur));
        toast.success("Note deleted");
      } catch (err) {
        toast.error((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    []
  );

  return { notes, loading, selectedId, setSelectedId, createNote, deleteNote, busy };
}
