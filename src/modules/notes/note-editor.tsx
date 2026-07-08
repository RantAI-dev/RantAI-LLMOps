"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownPreview } from "@/modules/notes/markdown-preview";

/**
 * Editor for one note. Mounted with `key={noteId}` by the workspace so switching
 * notes gives a fresh load/draft — no cross-note state bleed. `onDirtyChange`
 * lets the workspace warn before discarding unsaved edits on a note switch.
 */
export function NoteEditor({
  noteId,
  title,
  onDirtyChange,
}: {
  noteId: string;
  title: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [saved, setSaved] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const dirty = draft !== saved;

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/notes/${encodeURIComponent(noteId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { content?: string } | null) => {
        if (cancelled) return;
        const content = data?.content ?? "";
        setSaved(content);
        setDraft(content);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(noteId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: draft }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Gagal menyimpan catatan");
      }
      setSaved(draft);
      toast.success("Catatan tersimpan", { description: title });
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex items-start justify-between gap-3 border-b border-hairline pb-4">
        <h2 className="min-w-0 truncate text-xl font-semibold leading-8 tracking-tight text-primary">
          {title}
        </h2>
        <Button type="button" onClick={handleSave} disabled={!dirty || saving || loading}>
          <Save className="size-4" /> {saving ? "Menyimpan…" : dirty ? "Simpan" : "Tersimpan"}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 px-1 py-10 text-sm text-ink-soft">
          <Loader2 className="size-4 animate-spin" /> Memuat catatan…
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2">
          <div className="flex min-h-[320px] flex-col">
            <p className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
              Markdown
            </p>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={"# Judul\n\nTulis catatan di sini.\n\n- poin-poin\n- **tebal** dan `inline code`"}
              className="min-h-[320px] flex-1 resize-none font-mono text-[13px] leading-6"
            />
          </div>
          <div className="flex min-h-[320px] flex-col">
            <p className="mb-1.5 text-[11px] font-medium tracking-wide text-ink-faint uppercase">
              Preview
            </p>
            <div className="flex-1 overflow-y-auto rounded-md border border-hairline bg-surface p-4">
              <MarkdownPreview source={draft} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
