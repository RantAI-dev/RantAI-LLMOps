"use client";

import { useEffect, useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Note, Spinner } from "@/modules/duo/components/duo-ui";
import { FS_NAMES, MEMORY_KINDS, q, slug, type MemoryKind } from "@/modules/duo/components/files/fs-lib";
import { gw, GwError } from "@/modules/duo/lib/gw";

/** What the editor is for: a new memory file, a new skill, or an existing file (by URI). */
export type EditorTarget =
  | { mode: "new-memory"; kind: MemoryKind }
  | { mode: "new-skill" }
  | { mode: "edit"; uri: string; isSkill: boolean; content: string; title: string };

const SKILL_TEMPLATE = "---\nname: \ndescription: \ntags: []\n---\n1. ";

/** The dialog that writes a memory file or a skill (`PUT /v1/fs/write`). `onSaved` gets the URI written. */
export function FsEditor({ target, onClose, onSaved }: { target: EditorTarget | null; onClose: () => void; onSaved: (uri: string) => void }) {
  // Unsaved text is not lost to a stray Escape or a click outside: closing asks first.
  const [dirty, setDirty] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  const finish = () => {
    setDirty(false);
    setAskDiscard(false);
    onClose();
  };
  const requestClose = () => {
    if (dirty && !askDiscard) setAskDiscard(true);
    else finish();
  };
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl" showCloseButton={false}>
        {target ? (
          <EditorBody
            key={target.mode === "edit" ? target.uri : target.mode}
            target={target}
            onDirty={setDirty}
            askDiscard={askDiscard}
            onKeepEditing={() => setAskDiscard(false)}
            onRequestClose={requestClose}
            onDiscard={finish}
            onSaved={(uri) => {
              setDirty(false);
              setAskDiscard(false);
              onSaved(uri);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EditorBody({
  target,
  onDirty,
  askDiscard,
  onKeepEditing,
  onRequestClose,
  onDiscard,
  onSaved,
}: {
  target: EditorTarget;
  onDirty: (dirty: boolean) => void;
  askDiscard: boolean;
  onKeepEditing: () => void;
  onRequestClose: () => void;
  onDiscard: () => void;
  onSaved: (uri: string) => void;
}) {
  const ids = useId();
  const isSkill = target.mode === "new-skill" || (target.mode === "edit" && target.isSkill);
  const start = target.mode === "edit" ? target.content : isSkill ? SKILL_TEMPLATE : "";
  const [kind, setKind] = useState<MemoryKind>(target.mode === "new-memory" ? target.kind : "notes");
  const [name, setName] = useState("");
  const [text, setText] = useState(start);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The URI of a new file whose name is already taken, once the person was told; saving again replaces it.
  const [taken, setTaken] = useState<string | null>(null);
  const dirty = text !== start || name.trim() !== "";
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const key = slug(name);
  const currentUri = target.mode === "edit" ? target.uri : isSkill ? `nafs://skills/${key}` : `nafs://memory/${kind}/${key}`;
  const preview = target.mode === "edit" ? target.uri : isSkill ? `nafs://skills/${key || "…"}` : `nafs://memory/${kind}/${key || "…"}`;

  async function save() {
    setError(null);
    let uri: string;
    let content = text;
    if (target.mode === "edit") {
      uri = target.uri;
    } else {
      if (!key) {
        setError(isSkill ? "Give the skill a name, using letters or digits." : "Give it a title, using letters or digits.");
        return;
      }
      uri = isSkill ? `nafs://skills/${key}` : `nafs://memory/${kind}/${key}`;
      // A new memory file starts with its title as a heading (unless the text brings its own front matter).
      if (!isSkill && name.trim() && !/^---/.test(content)) content = `# ${name.trim()}\n${content}`;
      if (isSkill) content = content.replace(/^name:\s*$/m, `name: ${key}`);
    }
    if (!content.trim()) {
      setError(isSkill ? "Write the instructions first." : "Write what to remember first.");
      return;
    }
    setSaving(true);
    try {
      // A new file must not silently replace one with the same name: ask first (a 404 means the name is free).
      if (target.mode !== "edit" && taken !== uri) {
        const exists = await gw(`/v1/fs/stat?uri=${q(uri)}`).then(
          () => true,
          (err: unknown) => {
            if (err instanceof GwError && err.status === 404) return false;
            throw err;
          }
        );
        if (exists) {
          setTaken(uri);
          return;
        }
      }
      await gw(`/v1/fs/write?uri=${q(uri)}`, { method: "PUT", body: { content } });
      onSaved(uri);
    } catch (err) {
      setError(err instanceof GwError ? err.message : "The file could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <DialogHeader>
        <DialogTitle>{target.mode === "edit" ? `Edit ${target.title}` : isSkill ? "New skill" : "New memory"}</DialogTitle>
        <DialogDescription>
          {isSkill
            ? "A skill is a set of instructions the assistant can follow for a task, written in Markdown."
            : "A memory file is something the assistant keeps about you and reads when it helps. Every change is listed under Memory and can be undone."}
        </DialogDescription>
      </DialogHeader>

      {target.mode === "new-skill" ? (
        <div className="grid gap-1 text-sm">
          <label htmlFor={`${ids}-name`} className="font-medium">
            Name
          </label>
          <Input id={`${ids}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={64} placeholder="for example: release-notes" aria-describedby={`${ids}-key`} autoFocus />
          <span id={`${ids}-key`} className="text-xs text-ink-faint">
            Lower-case letters, digits and dashes. Saved as <code className="break-all">{preview}</code>
          </span>
        </div>
      ) : target.mode === "new-memory" ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="grid gap-1 text-sm">
            <label htmlFor={`${ids}-kind`} className="font-medium">
              Kind
            </label>
            <select
              id={`${ids}-kind`}
              value={kind}
              onChange={(e) => setKind(e.target.value as MemoryKind)}
              className="h-8 w-full rounded-[var(--radius-md)] border border-input bg-background px-2 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
            >
              {MEMORY_KINDS.map((k) => (
                <option key={k} value={k}>
                  {FS_NAMES[k]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1 text-sm">
            <label htmlFor={`${ids}-name`} className="font-medium">
              Title
            </label>
            <Input id={`${ids}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="for example: Answer language" aria-describedby={`${ids}-key`} autoFocus />
            <span id={`${ids}-key`} className="text-xs text-ink-faint">
              Saved as <code className="break-all">{preview}</code>
            </span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-ink-faint">
          <code className="break-all">{target.uri}</code>
        </p>
      )}

      <div className="grid gap-1 text-sm">
        <label htmlFor={`${ids}-text`} className="font-medium">
          {isSkill ? "Instructions (Markdown; the front matter is optional)" : "What to remember"}
        </label>
        <Textarea
          id={`${ids}-text`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          spellCheck={!isSkill}
          className="max-h-[50dvh] min-h-48 font-mono text-xs leading-5 md:text-xs"
          autoFocus={target.mode === "edit"}
        />
      </div>

      {error ? <Note tone="bad">{error}</Note> : null}
      {taken && taken === currentUri ? (
        <Note tone="warn">
          <code className="break-all">{taken}</code> already exists. Save again to replace it, or change the {isSkill ? "name" : "title"} to keep both.
        </Note>
      ) : null}
      {askDiscard ? (
        <Note tone="warn" className="flex flex-wrap items-center gap-2">
          <span className="flex-1">You have changes that are not saved.</span>
          <Button type="button" size="xs" variant="outline" onClick={onKeepEditing}>
            Keep editing
          </Button>
          <Button type="button" size="xs" variant="destructive" onClick={onDiscard}>
            Discard changes
          </Button>
        </Note>
      ) : null}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onRequestClose} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" variant={taken && taken === currentUri ? "destructive" : "default"} disabled={saving}>
          {saving ? <Spinner className="size-3.5 text-primary-foreground" /> : null}
          {saving ? "Saving…" : taken && taken === currentUri ? "Replace it" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
