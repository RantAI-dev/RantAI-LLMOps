/**
 * Limits and path/MIME rules of image-dataset uploads, shared by the browser (the "Add dataset" dialog
 * plans its batches with them) and the server (the upload routes enforce them). No server-only imports.
 *
 * The browser only ever sees the defaults; the server reads VISION_DATASET_MAX_BYTES / VISION_IMAGE_MAX_BYTES
 * so an operator can raise or lower them, and answers 413 past them.
 */

export const DEFAULT_VISION_DATASET_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export const DEFAULT_VISION_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/** One `files` request carries at most this much (below the proxy body limit in next.config.ts). */
export const VISION_BATCH_MAX_BYTES = 20 * 1024 * 1024;
/** Multipart framing and the other form fields on top of the file bytes. */
export const VISION_BATCH_ENVELOPE_BYTES = 1024 * 1024;
export const VISION_MAX_RELPATH_CHARS = 300;
/** train.jsonl / eval.jsonl: same ceiling as every other dataset file. */
export const VISION_JSONL_MAX_BYTES = 100 * 1024 * 1024;

function intEnv(v: string | undefined, fallback: number): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export type VisionLimits = { maxDatasetBytes: number; maxImageBytes: number };

export function visionLimits(env: Record<string, string | undefined> = {}): VisionLimits {
  return {
    maxDatasetBytes: intEnv(env.VISION_DATASET_MAX_BYTES, DEFAULT_VISION_DATASET_MAX_BYTES),
    maxImageBytes: intEnv(env.VISION_IMAGE_MAX_BYTES, DEFAULT_VISION_IMAGE_MAX_BYTES),
  };
}

const EXT_MIME: Record<string, string> = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** MIME an extension promises, or null for anything that is not an accepted image type. */
export function mimeForPath(path: string): string | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
  return (ext && EXT_MIME[ext]) || null;
}

/** MIME from the first bytes (the file's real type, whatever its name says), or null when it is not png/jpeg/webp. */
export function sniffImageMime(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return "image/png";
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return "image/webp";
  }
  return null;
}

/**
 * null when `relpath` may be stored as a dataset image: `images/<...>.(jpg|jpeg|png|webp)`, relative,
 * without ".." / "." / empty segments, backslashes, NUL or control characters.
 */
export function imageRelpathProblem(relpath: string): string | null {
  if (typeof relpath !== "string" || relpath === "") return "relpath is empty";
  if (relpath.length > VISION_MAX_RELPATH_CHARS) return `relpath is longer than ${VISION_MAX_RELPATH_CHARS} characters`;
  if (/[\u0000-\u001f\u007f\\]/.test(relpath)) return "relpath has a backslash or control character";
  const segments = relpath.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return 'relpath has an empty, "." or ".." segment';
  if (segments[0] !== "images" || segments.length < 2) return 'relpath must be under "images/"';
  if (!mimeForPath(relpath)) return "relpath must end in .jpg, .jpeg, .png or .webp";
  return null;
}

/** Group `items` (in order) into batches whose total size stays within `maxBytes`; an item bigger than that gets its own. */
export function planBatches<T extends { size: number }>(items: T[], maxBytes: number): T[][] {
  const batches: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const it of items) {
    if (cur.length > 0 && bytes + it.size > maxBytes) {
      batches.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(it);
    bytes += it.size;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}
