/**
 * Server-only helpers for Notes.
 *
 * The app shows a flat list of notes. Transformer Lab has no notes primitive of
 * its own beyond a single `notes/readme.md` per experiment, so each note is
 * backed by a hidden experiment whose id carries {@link NOTE_PREFIX}. That keeps
 * the notes namespace separate from real job experiments (see `allExperimentIds`)
 * and reuses TL's per-experiment markdown store — notes live on the server and
 * are team-visible, not in one browser's localStorage. The "experiment" backing
 * is never surfaced in the UI.
 */
import { inferenceHeaders } from "@/lib/inference";
import { TL_ROOT } from "@/lib/models-catalog";
import { logServerError } from "@/lib/log";
import { NOTE_PREFIX } from "@/lib/tl-constants";
import {
  createTlExperiment,
  deleteTlExperiment,
  listTlExperiments,
} from "@/lib/tasks-server";

export type NoteSummary = { id: string; title: string };

/** `"note-catatan-model-a"` → `"Catatan Model A"` (display title from the id). */
export function noteTitleFromId(id: string): string {
  const slug = id.startsWith(NOTE_PREFIX) ? id.slice(NOTE_PREFIX.length) : id;
  const words = slug.replace(/-+/g, " ").trim();
  return words ? words.replace(/\b\w/g, (c) => c.toUpperCase()) : id;
}

/** `"Catatan Model A"` → `"note-catatan-model-a"` (slug-safe, TL-safe id). */
export function noteIdFromTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${NOTE_PREFIX}${slug}`;
}

/** All notes (the `note-*` experiments), title-cased for display. */
export async function listNotes(): Promise<NoteSummary[]> {
  const experiments = await listTlExperiments().catch(() => []);
  return experiments
    .filter((e) => e.id.startsWith(NOTE_PREFIX))
    .map((e) => ({ id: e.id, title: noteTitleFromId(e.id) }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Create a note from a title. Returns the note plus `existed` (a different title
 * can slugify onto an existing note — TL create is idempotent, so we report the
 * collision instead of pretending it's new). Null if the title has no usable
 * characters. Uses TL's authoritative returned id (in case it secures the slug).
 */
export async function createNote(
  title: string
): Promise<{ note: NoteSummary; existed: boolean } | null> {
  const slugId = noteIdFromTitle(title);
  if (slugId === NOTE_PREFIX) return null; // title slugged to nothing
  const existed = (await listNotes()).some((n) => n.id === slugId);
  const id = await createTlExperiment(slugId);
  // Seed the readme with the title as an H1 so the editor opens with context.
  const existing = await getNoteContent(id);
  if (!existing.trim()) await saveNoteContent(id, `# ${title.trim()}\n\n`);
  return { note: { id, title: noteTitleFromId(id) }, existed };
}

/** Delete a note. Guarded to the notes namespace so it can't touch a job experiment. */
export async function deleteNote(id: string): Promise<boolean> {
  if (!id.startsWith(NOTE_PREFIX)) return false;
  return deleteTlExperiment(id);
}

export async function getNoteContent(id: string): Promise<string> {
  try {
    const res = await fetch(`${TL_ROOT}/experiment/${encodeURIComponent(id)}/notes`, {
      headers: inferenceHeaders(),
    });
    if (!res.ok) return "";
    const data = await res.json().catch(() => "");
    return typeof data === "string" ? data : "";
  } catch (err) {
    logServerError("getNoteContent", err);
    return "";
  }
}

export async function saveNoteContent(id: string, content: string): Promise<boolean> {
  try {
    const res = await fetch(`${TL_ROOT}/experiment/${encodeURIComponent(id)}/notes`, {
      method: "POST",
      headers: inferenceHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(content), // the endpoint wants the note as a raw JSON string
    });
    return res.ok;
  } catch {
    return false;
  }
}
