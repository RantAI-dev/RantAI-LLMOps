/**
 * Reading an image-dataset ZIP in the browser (fflate). The ZIP is: `train.jsonl` (required), `eval.jsonl`
 * (optional), `images/**`. Nothing is decompressed until it is needed: the listing comes from the central
 * directory, the JSONL files and the thumbnails are extracted on their own, and the images are extracted a batch
 * at a time while uploading.
 *
 * A ZIP made by zipping a folder has one wrapper directory (`my-dataset/train.jsonl`): that single top folder is
 * stripped. macOS metadata (`__MACOSX/`, `.DS_Store`) is ignored.
 */
import { unzipSync } from "fflate";

import { imageRelpathProblem, mimeForPath } from "@/lib/vision-limits";

export type ZipListingEntry = { name: string; size: number };

export type VisionZipLayout = {
  /** Folder stripped from every name ("" when train.jsonl is at the top). */
  prefix: string;
  train: ZipListingEntry | null;
  eval: ZipListingEntry | null;
  /** Images, with their dataset path (`images/a.png`) and their name inside the ZIP. */
  images: Array<{ path: string; zipName: string; size: number }>;
  /** Files under images/ that cannot be used (wrong type, ".." in the name, ...). */
  rejected: string[];
  /** Files that are not part of the dataset (ignored). */
  ignored: number;
};

const isJunk = (name: string) => name.endsWith("/") || name.startsWith("__MACOSX/") || /(^|\/)(\.DS_Store|Thumbs\.db)$/.test(name);

/** Work out the dataset layout from a ZIP listing (pure). */
export function normalizeZipListing(listing: ZipListingEntry[]): VisionZipLayout {
  const files = listing.filter((e) => !isJunk(e.name));
  const names = new Set(files.map((f) => f.name));
  let prefix = "";
  if (!names.has("train.jsonl")) {
    const wrappers = files.map((f) => /^([^/]+\/)train\.jsonl$/.exec(f.name)?.[1]).filter((p): p is string => !!p);
    if (wrappers.length === 1) prefix = wrappers[0]!;
  }
  const out: VisionZipLayout = { prefix, train: null, eval: null, images: [], rejected: [], ignored: 0 };
  for (const f of files) {
    if (!f.name.startsWith(prefix)) {
      out.ignored += 1;
      continue;
    }
    const rel = f.name.slice(prefix.length);
    if (rel === "train.jsonl") out.train = f;
    else if (rel === "eval.jsonl") out.eval = f;
    else if (rel.startsWith("images/")) {
      // "images/a.gif" and the like are rejected by name; a path that escapes ("images/../x.png") is too.
      if (imageRelpathProblem(rel) === null && mimeForPath(rel)) out.images.push({ path: rel, zipName: f.name, size: f.size });
      else out.rejected.push(rel);
    } else out.ignored += 1;
  }
  return out;
}

/** The ZIP's central directory (names and uncompressed sizes) without decompressing anything. Throws when it is not a ZIP. */
export function listZip(bytes: Uint8Array): ZipListingEntry[] {
  const out: ZipListingEntry[] = [];
  unzipSync(bytes, {
    filter: (f) => {
      out.push({ name: f.name, size: f.originalSize });
      return false;
    },
  });
  return out;
}

/** Decompress only the named entries. */
export function extractZip(bytes: Uint8Array, zipNames: Iterable<string>): Record<string, Uint8Array> {
  const want = new Set(zipNames);
  return unzipSync(bytes, { filter: (f) => want.has(f.name) });
}

/** `data:<mime>;base64,...` for an image's bytes (CSP allows `data:` images, not `blob:`). */
export function imageDataUrl(path: string, bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mimeForPath(path) ?? "application/octet-stream"};base64,${btoa(bin)}`;
}
