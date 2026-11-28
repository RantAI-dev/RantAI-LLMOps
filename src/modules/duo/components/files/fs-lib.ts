/**
 * Shared shapes and helpers for the Files & memory section: the gateway's context filesystem (`nafs://...`).
 * Field names follow rust/crates/nafs-gateway/src/fs.rs; every field is optional here because the gateway leaves
 * fields out when they do not apply.
 */

import { arr, rec, str } from "@/modules/duo/components/duo-ui";
import { saveBlob } from "@/modules/duo/lib/gw";

export const ROOT = "nafs://";

/** Plain names for the spaces and memory kinds (as in the original web app). */
export const FS_NAMES: Record<string, string> = {
  kb: "Knowledge",
  memory: "Memory",
  skills: "Skills",
  sessions: "Saved chats",
  profile: "Profile",
  preferences: "Preferences",
  entities: "People and things",
  events: "Events",
  notes: "Notes",
};

export const MEMORY_KINDS = ["profile", "preferences", "entities", "events", "notes"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const FS_LEVELS = [
  { id: "0", label: "Summary", hint: "One line" },
  { id: "1", label: "Overview", hint: "The main points" },
  { id: "2", label: "Full", hint: "Everything" },
] as const;
export type FsLevel = "0" | "1" | "2";

export type FsItem = {
  uri: string;
  name: string;
  dir: boolean;
  l0?: string;
  title?: string;
  documents?: number;
  passages?: number;
  files?: number;
  updated?: string;
  tags?: string[];
  status?: string;
  page?: number | null;
};

export type FsListing = { uri: string; parent: string | null; items: FsItem[] };

export type FsKind = "root" | "directory" | "base" | "document" | "passage" | "memory" | "skill" | "session" | string;

export type FsRead = { uri: string; kind: FsKind; level: number; content: string; meta: Record<string, unknown> };

export type FsHit = { uri: string; level?: number; score?: number; title?: string; l0?: string; text?: string; category?: string };

export type DiffRow = {
  id: string;
  at?: string;
  op: string;
  uri: string;
  title?: string;
  reason?: string;
  undone?: boolean;
};

/** Query-string value for a URI (spaces, unicode, `#` and `%` all survive). */
export const q = (uri: string) => encodeURIComponent(uri);

/** Safe decode of one percent-encoded URI segment (a malformed one is shown as is). */
export function decodeSeg(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The path segments after `nafs://`, still encoded, without the `#p…` fragment. */
export function segments(uri: string): string[] {
  return uri.replace(/^nafs:\/\//, "").replace(/#.*$/, "").split("/").filter(Boolean);
}

/** The top-level space of a URI ("memory", "skills", …) or null at the root. */
export const spaceOf = (uri: string) => segments(uri)[0] ?? null;

/** The folder holding a URI: a passage's document, a file's folder, the root for a space. */
export function parentOf(uri: string): string {
  if (uri.includes("#")) return uri.replace(/#.*$/, "");
  const segs = segments(uri);
  if (segs.length <= 1) return ROOT;
  return ROOT + segs.slice(0, -1).join("/");
}

/**
 * Whether a URI names a folder, from its shape: the root, a space, a knowledge base and its documents (whose
 * passages are listed inside), and the memory kinds. Memory files, skills, saved chats and passages are items.
 */
export function isDirUri(uri: string): boolean {
  if (uri.includes("#")) return false;
  const s = segments(uri);
  if (s.length <= 1) return true;
  if (s[0] === "kb") return s.length <= 3;
  if (s[0] === "memory") return s.length === 2;
  return false;
}

/** The breadcrumb trail for a folder: [uri, raw last segment] pairs, the root first. */
export function trail(uri: string): Array<{ uri: string; seg: string | null }> {
  const out: Array<{ uri: string; seg: string | null }> = [{ uri: ROOT, seg: null }];
  let acc = ROOT;
  segments(uri).forEach((p, i) => {
    acc += (i ? "/" : "") + p;
    out.push({ uri: acc, seg: p });
  });
  return out;
}

/** The label for an item: a plain name for a known space or kind, its title, or its decoded name. */
export function labelOf(uri: string, name: string | null | undefined, titles: Record<string, string>, title?: string | null): string {
  if (uri === ROOT) return "All";
  const n = name ? decodeSeg(name) : decodeSeg(segments(uri).pop() ?? uri);
  const depth = segments(uri).length;
  // Names of spaces (depth 1) and memory kinds (nafs://memory/<kind>) are shown in plain words.
  if (depth === 1 || (depth === 2 && spaceOf(uri) === "memory")) {
    if (FS_NAMES[n]) return FS_NAMES[n];
  }
  return (title && title.trim()) || titles[uri] || n;
}

/** The memory kind in nafs://memory/<kind>/<key>, or null. */
export function memoryKindOf(uri: string): MemoryKind | null {
  const s = segments(uri);
  return s[0] === "memory" && (MEMORY_KINDS as readonly string[]).includes(s[1] ?? "") ? (s[1] as MemoryKind) : null;
}

/** Only memory files and skills can be written; sessions can also be removed. Everything else is read only. */
export const isEditable = (kind: FsKind) => kind === "memory" || kind === "skill";
export const isRemovable = (kind: FsKind) => kind === "memory" || kind === "skill" || kind === "session";

/**
 * The server's key rule: lower-case ASCII letters and digits joined by single dashes, at most 64, no dash at either
 * end. Accents are folded first (é → e).
 */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
}

/** The text shown in an empty folder. */
export function emptyText(uri: string): string {
  if (uri.startsWith("nafs://memory")) return "Nothing here yet. Tell the assistant “remember that …”, save a chat as a file, or add one with New memory.";
  if (uri.startsWith("nafs://skills")) return "No skills yet. A skill is a set of instructions for a task, written in Markdown. Add one with New skill.";
  if (uri.startsWith("nafs://sessions")) return "No chats saved as files yet. Save one from the list on the right.";
  if (uri.startsWith("nafs://kb")) return "No documents here yet. Add them on the Knowledge page.";
  return "This folder is empty.";
}

export const OP_LABEL: Record<string, string> = { add: "Added", update: "Changed", delete: "Deleted", skip: "Skipped" };
export const CATEGORY_LABEL: Record<string, string> = { passage: "Passage", document: "Document", memory: "Memory", skill: "Skill", session: "Saved chat" };

// ---------- null-safe normalisers (the live gateway could not be reached while this was written) ----------

export function toListing(d: unknown, uri: string): FsListing {
  const r = rec(d);
  const items = arr(r.items)
    .map((x) => rec(x))
    .filter((x) => typeof x.uri === "string")
    .map(
      (x) =>
        ({
          ...x,
          uri: x.uri as string,
          name: str(x.name, ""),
          dir: x.dir === true,
          l0: typeof x.l0 === "string" ? x.l0 : undefined,
          title: typeof x.title === "string" ? x.title : undefined,
        }) as FsItem
    );
  return { uri: str(r.uri, uri), parent: typeof r.parent === "string" ? r.parent : null, items };
}

export function toRead(d: unknown, uri: string): FsRead {
  const r = rec(d);
  return {
    uri: str(r.uri, uri),
    kind: str(r.kind, "directory"),
    level: typeof r.level === "number" ? r.level : 1,
    content: typeof r.content === "string" ? r.content : "",
    meta: rec(r.meta),
  };
}

export function toHits(d: unknown): FsHit[] {
  return arr(rec(d).hits)
    .map((x) => rec(x))
    .filter((x) => typeof x.uri === "string") as unknown as FsHit[];
}

export function toDiff(d: unknown): DiffRow[] {
  const r = rec(d);
  const rows = Array.isArray(d) ? d : arr(r.diff);
  return rows
    .map((x) => rec(x))
    .filter((x) => typeof x.id === "string" || typeof x.id === "number")
    .map((x) => ({ ...x, id: String(x.id), op: str(x.op, "update"), uri: str(x.uri, "") }) as DiffRow);
}

/** Save text as a Markdown file in the browser. */
export function saveText(text: string, name: string) {
  saveBlob(new Blob([text], { type: "text/markdown;charset=utf-8" }), name);
}
