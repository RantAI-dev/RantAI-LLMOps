/**
 * Stored chat images (D3). The Playground uploads each attached picture once; the conversation keeps
 * only the reference `/api/chat-images/<sha256>`, so the saved chat stays small and nothing re-uploads
 * base64 on every autosave. The BFF swaps the reference for a data URL just before the request goes
 * to the engine.
 *
 * Files live in `$RANTAI_DATA_DIR/chat-images/<sha256>.<ext>`. The name is the content hash, so the
 * same picture is stored once, and a hash is the only thing that ever reaches the filesystem
 * (`^[a-f0-9]{64}$`), so there is no path to traverse.
 *
 * Server only (node:fs). The pure rules (limits, MIME, ref format) live in `chat-content.ts`.
 */
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import {
  ALLOWED_IMAGE_MIME,
  IMAGE_REF_PREFIX,
  chatLimits,
  imageRefSha,
  mapImageUrls,
  type MessageContent,
} from "@/lib/chat-content";
import { dataDir } from "@/lib/json-dir-store";

export const SHA_RE = /^[a-f0-9]{64}$/;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MIME_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(EXT).map(([m, e]) => [e, m]));
const DAY_MS = 24 * 60 * 60 * 1000;

/** Rejected upload; `status` is the HTTP code the route answers with. */
export class ChatImageError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 = 400,
  ) {
    super(message);
  }
}

export function chatImagesDir(): string {
  return path.join(dataDir(), "chat-images");
}

/** The real type of the bytes by magic number (a declared MIME is never trusted on its own). */
export function sniffImageMime(b: Uint8Array): string | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x);
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (b.length >= 6 && at(0, 0x47, 0x49, 0x46, 0x38) && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) {
    return "image/gif";
  }
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

/** Same pattern as `json-dir-store.atomicWrite` (temp file, then rename), for bytes. */
async function atomicWriteBytes(file: string, data: Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}

export const chatImageRef = (sha: string) => `${IMAGE_REF_PREFIX}${sha}`;

/** Store an image; returns its sha and reference. Throws `ChatImageError` on a bad MIME or size. */
export async function saveChatImage(
  bytes: Uint8Array,
  declaredMime?: string,
): Promise<{ sha: string; ref: string; mime: string; bytes: number }> {
  if (declaredMime && !(ALLOWED_IMAGE_MIME as readonly string[]).includes(declaredMime)) {
    throw new ChatImageError("Image must be png, jpeg, webp or gif");
  }
  const mime = sniffImageMime(bytes);
  if (!mime) throw new ChatImageError("Image must be png, jpeg, webp or gif");
  if (declaredMime && declaredMime !== mime) {
    throw new ChatImageError(`Declared type ${declaredMime} does not match the file (${mime})`);
  }
  const { maxImageBytes } = chatLimits();
  if (bytes.byteLength > maxImageBytes) {
    throw new ChatImageError(`Image larger than ${Math.round(maxImageBytes / 1024 / 1024)} MB`, 413);
  }
  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  const file = path.join(chatImagesDir(), `${sha}.${EXT[mime]}`);
  try {
    // Same picture again: keep the file, restart its age so pruning does not take it from under a new chat.
    const now = new Date();
    await fs.utimes(file, now, now);
  } catch {
    await atomicWriteBytes(file, bytes);
  }
  return { sha, ref: chatImageRef(sha), mime, bytes: bytes.byteLength };
}

/** Bytes and MIME of a stored image, or null for a malformed hash or a missing file. */
export async function readChatImage(sha: string): Promise<{ bytes: Buffer; mime: string } | null> {
  if (!SHA_RE.test(sha)) return null;
  for (const [ext, mime] of Object.entries(MIME_BY_EXT)) {
    try {
      return { bytes: await fs.readFile(path.join(chatImagesDir(), `${sha}.${ext}`)), mime };
    } catch {
      /* try the next extension */
    }
  }
  return null;
}

export async function chatImageDataUrl(sha: string): Promise<string | null> {
  const img = await readChatImage(sha);
  return img ? `data:${img.mime};base64,${img.bytes.toString("base64")}` : null;
}

/**
 * Replace every `/api/chat-images/<sha>` in a message with its data URL. Other URLs are left alone.
 * Returns the missing sha when a referenced file is gone (e.g. pruned), so the caller can answer 400.
 */
export async function resolveImageRefs(
  content: MessageContent,
): Promise<{ ok: true; content: MessageContent } | { ok: false; missing: string }> {
  if (typeof content === "string") return { ok: true, content };
  const urls = new Map<string, string>();
  for (const part of content) {
    if (part.type !== "image_url") continue;
    const sha = imageRefSha(part.image_url.url);
    if (!sha || urls.has(part.image_url.url)) continue;
    const dataUrl = await chatImageDataUrl(sha);
    if (!dataUrl) return { ok: false, missing: sha };
    urls.set(part.image_url.url, dataUrl);
  }
  return { ok: true, content: mapImageUrls(content, (u) => urls.get(u) ?? u) };
}

/** Every stored-image sha mentioned anywhere in `value` (a list of conversations, say). */
export function referencedShas(value: unknown): Set<string> {
  const out = new Set<string>();
  const re = /\/api\/chat-images\/([a-f0-9]{64})/g;
  for (const m of JSON.stringify(value ?? null).matchAll(re)) out.add(m[1]);
  return out;
}

/** Images younger than this are never deleted, whatever the setting. */
export const MIN_PRUNE_AGE_DAYS = 7;

export type PruneResult = { deleted: number; kept: number; skipped?: string };

/**
 * Delete stored images that no conversation refers to and that are older than `CHAT_IMAGE_PRUNE_DAYS`
 * (default and floor: 7 days). Conservative by design: when the conversations cannot be listed
 * (`listConversations` gives null) nothing is deleted, because an empty answer from a failing backend
 * would look like "nothing is referenced". Never throws.
 */
export async function pruneChatImages(
  opts: {
    now?: number;
    minAgeDays?: number;
    /** Strict list: null when the backend failed. Defaults to the conversation store. */
    listConversations?: () => Promise<unknown[] | null>;
  } = {},
): Promise<PruneResult> {
  try {
    const now = opts.now ?? Date.now();
    const envDays = Number(process.env.CHAT_IMAGE_PRUNE_DAYS);
    const days = Math.max(MIN_PRUNE_AGE_DAYS, opts.minAgeDays ?? (Number.isFinite(envDays) && envDays > 0 ? envDays : 0));
    let names: string[];
    try {
      names = await fs.readdir(chatImagesDir());
    } catch {
      return { deleted: 0, kept: 0 }; // no directory, nothing to do
    }
    const files = names.filter((n) => /^[a-f0-9]{64}\.(jpg|png|webp|gif)$/.test(n));
    const tmps = names.filter((n) => n.endsWith(".tmp"));
    // Leftovers of an interrupted write: a day is more than enough for any live upload.
    for (const t of tmps) {
      const f = path.join(chatImagesDir(), t);
      const st = await fs.stat(f).catch(() => null);
      if (st && now - st.mtimeMs > DAY_MS) await fs.rm(f, { force: true });
    }
    if (files.length === 0) return { deleted: 0, kept: 0 };

    let conversations: unknown[] | null;
    try {
      conversations = await (opts.listConversations ?? defaultList)();
    } catch {
      conversations = null;
    }
    if (!conversations) return { deleted: 0, kept: files.length, skipped: "conversations unavailable" };

    const used = referencedShas(conversations);
    let deleted = 0;
    for (const n of files) {
      if (used.has(n.slice(0, 64))) continue;
      const f = path.join(chatImagesDir(), n);
      const st = await fs.stat(f).catch(() => null);
      if (!st || now - st.mtimeMs < days * DAY_MS) continue;
      await fs.rm(f, { force: true });
      deleted += 1;
    }
    return { deleted, kept: files.length - deleted };
  } catch (err) {
    console.error("[chat-images] prune failed:", err);
    return { deleted: 0, kept: 0, skipped: "error" };
  }
}

async function defaultList(): Promise<unknown[] | null> {
  const { listConversationsStrict } = await import("@/lib/conversations-server");
  return listConversationsStrict();
}
