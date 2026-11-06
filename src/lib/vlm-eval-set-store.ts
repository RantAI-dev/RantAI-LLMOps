/**
 * Test sets for image-and-text (VLM) evals.
 *
 * A set is a folder under `$RANTAI_DATA_DIR/vlm-eval-sets/<id>/`:
 *
 *   meta.json     the record shown in the picker (`VlmEvalSet`)
 *   rows.jsonl    one `VlmEvalRow` per line: image path(s), the prompt and the key
 *   images/...    the image files the rows use, copied out of the ZIP
 *
 * It arrives as a ZIP in the dataset format of docs/RENCANA-VLM.md §3.1 (`train.jsonl`, `images/**`):
 * every row of `train.jsonl` is a row to score, the user message is the prompt and the last assistant
 * message the key. The ZIP is opened HERE, on the server, and treated as hostile: names that escape the
 * folder are refused, sizes are capped before anything is inflated (and checked again once it is), and
 * every image is sniffed for what it really is. The set is built in a scratch folder and renamed into
 * place, so a half-written set never shows up in the list.
 *
 * Why a copy and not a reference into the dataset: Transformer Lab only serves a dataset's files one at a
 * time, and a run reads every image of the set once per model. Limits (rows, total bytes, bytes per image)
 * are overridable with VLM_EVAL_MAX_ROWS, VLM_EVAL_MAX_BYTES and VLM_EVAL_MAX_IMAGE_BYTES.
 */
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

import { atomicWrite, dataDir } from "@/lib/json-dir-store";
import { imageRelpathProblem, mimeForPath, sniffImageMime, VISION_JSONL_MAX_BYTES } from "@/lib/vision-limits";
import { isVlmScoring, VLM_SCORING_MODES, type VlmScoring } from "@/lib/vlm-eval";
import {
  MIN_VLM_EVAL_ROWS,
  normalizeImagePath,
  validateVlmJsonl,
  validateVlmRow,
  vlmDatasetProblem,
  vlmMissingImagesProblem,
  vlmRowSummary,
} from "@/lib/vlm-schema";
import { extractZip, listZip, normalizeZipListing } from "@/modules/datasets/lib/vision-zip";

export type VlmEvalSet = {
  id: string;
  name: string;
  scoring: VlmScoring;
  rows: number;
  /** Image files stored (the ones the rows use). */
  images: number;
  source: "upload";
  createdAt: number;
};

/** One row to score. `id` is its position in the set and never changes. */
export type VlmEvalRow = {
  id: number;
  /** Image paths inside the set (`images/a.png`), in the order the row lists them. */
  images: string[];
  /** The user text of the row: what the model is asked. */
  prompt: string;
  /** The key: the last assistant message of the row. */
  gold: string;
  system?: string;
  category?: string;
};

export type VlmEvalLimits = { maxRows: number; maxBytes: number; maxImageBytes: number };

const intEnv = (v: string | undefined, fallback: number): number => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function vlmEvalLimits(env: Record<string, string | undefined> = process.env): VlmEvalLimits {
  return {
    maxRows: intEnv(env.VLM_EVAL_MAX_ROWS, 500),
    maxBytes: intEnv(env.VLM_EVAL_MAX_BYTES, 200 * 1024 * 1024),
    maxImageBytes: intEnv(env.VLM_EVAL_MAX_IMAGE_BYTES, 10 * 1024 * 1024),
  };
}

/** A refused upload; `status` is the HTTP code the route answers with. */
export class VlmEvalSetError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 413 = 400,
  ) {
    super(message);
  }
}

const ID = /^[a-z0-9][a-z0-9-]{0,80}$/;
const slugify = (name: string): string => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80).replace(/-$/, "");
/** More entries than any honest dataset of <= 500 rows has; a ZIP of a million empty files is not one. */
const MAX_ZIP_ENTRIES = 20_000;
const MAX_NAME_CHARS = 120;

export const isVlmEvalSetId = (id: string): boolean => ID.test(id);
const checkId = (id: string): void => {
  if (!ID.test(id)) throw new VlmEvalSetError(`Invalid eval set id: ${JSON.stringify(id)}`, 400);
};

const root = () => path.join(dataDir(), "vlm-eval-sets");
const setDir = (id: string) => path.join(root(), id);

const mb = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;

const categoryOf = (row: unknown): string | undefined => {
  const r = row as { category?: unknown; metadata?: { category?: unknown } } | null;
  const v = typeof r?.category === "string" ? r.category : typeof r?.metadata?.category === "string" ? r.metadata.category : "";
  const t = v.trim().slice(0, 80);
  return t || undefined;
};

/**
 * Build a test set from the bytes of a ZIP. Throws `VlmEvalSetError` (with the HTTP status) when the ZIP
 * cannot be used, saying why in words a person can act on.
 */
export async function createVlmEvalSetFromZip(input: {
  name: string;
  scoring: string;
  zip: Uint8Array;
  limits?: VlmEvalLimits;
}): Promise<VlmEvalSet> {
  const lim = input.limits ?? vlmEvalLimits();
  const name = input.name.trim();
  if (!name) throw new VlmEvalSetError("Test set name is required");
  if (name.length > MAX_NAME_CHARS) throw new VlmEvalSetError(`The name may be at most ${MAX_NAME_CHARS} characters`);
  const id = slugify(name);
  if (!id || !ID.test(id)) throw new VlmEvalSetError("Test set name is required (use letters and numbers)");
  if (!isVlmScoring(input.scoring)) {
    throw new VlmEvalSetError(`Scoring must be one of: ${VLM_SCORING_MODES.join(", ")}`);
  }
  const scoring = input.scoring;
  if (await exists(setDir(id))) {
    throw new VlmEvalSetError(`A test set named "${id}" already exists. Use another name or delete it first.`, 409);
  }
  if (input.zip.byteLength > lim.maxBytes) throw new VlmEvalSetError(`The ZIP is larger than ${mb(lim.maxBytes)}`, 413);

  // 1. The central directory only: names and DECLARED sizes, nothing inflated yet.
  let listing: ReturnType<typeof listZip>;
  try {
    listing = listZip(input.zip);
  } catch {
    throw new VlmEvalSetError("The file is not a valid ZIP archive");
  }
  if (listing.length > MAX_ZIP_ENTRIES) throw new VlmEvalSetError(`The ZIP has more than ${MAX_ZIP_ENTRIES} entries`, 413);
  const layout = normalizeZipListing(listing);
  if (!layout.train) {
    throw new VlmEvalSetError("The ZIP has no train.jsonl (for a test set, put the rows to score in train.jsonl, with the images under images/)");
  }
  const jsonlCap = Math.min(VISION_JSONL_MAX_BYTES, lim.maxBytes);
  if (layout.train.size > jsonlCap) throw new VlmEvalSetError(`train.jsonl is larger than ${mb(jsonlCap)}`, 413);

  // 2. train.jsonl, checked against the images the ZIP really holds.
  const trainName = layout.train.name;
  const trainBytes = extractZip(input.zip, [trainName])[trainName];
  if (!trainBytes) throw new VlmEvalSetError("train.jsonl could not be read from the ZIP");
  if (trainBytes.byteLength > jsonlCap) throw new VlmEvalSetError(`train.jsonl is larger than ${mb(jsonlCap)}`, 413);
  const text = new TextDecoder().decode(trainBytes);
  const inZip = new Map(layout.images.map((i) => [i.path, i]));
  const opts = { imageExists: (p: string) => inZip.has(p) };
  const report = validateVlmJsonl(text, opts);
  const problem = vlmMissingImagesProblem(report, "test set") ?? vlmDatasetProblem(report, "test set", MIN_VLM_EVAL_ROWS);
  if (problem) throw new VlmEvalSetError(problem);
  if (report.external.length > 0) {
    throw new VlmEvalSetError(
      `A test set needs its images inside the ZIP, but ${report.external.length} image${report.external.length === 1 ? " is" : "s are"} an https:// or s3:// reference (${report.external.slice(0, 2).join(", ")}).`
    );
  }

  const rows: VlmEvalRow[] = [];
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue; // counted as invalid by the report (within the 2% allowance)
    }
    if (!validateVlmRow(parsed, opts).ok) continue;
    const s = vlmRowSummary(parsed);
    if (s.images.length === 0) throw new VlmEvalSetError(`Row ${rows.length + 1} has no image: every row of a vision test set needs one`);
    const category = categoryOf(parsed);
    rows.push({
      id: rows.length,
      images: s.images.map(normalizeImagePath),
      prompt: s.user,
      gold: s.assistant,
      ...(s.system ? { system: s.system } : {}),
      ...(category ? { category } : {}),
    });
  }
  if (rows.length > lim.maxRows) {
    throw new VlmEvalSetError(`The test set has ${rows.length} rows; at most ${lim.maxRows} are allowed (a run sends every row to the live model)`, 413);
  }

  // 3. Only the images the rows use are kept; their declared sizes are capped before any is inflated.
  const used = [...new Set(rows.flatMap((r) => r.images))];
  let declared = 0;
  for (const p of used) {
    const size = inZip.get(p)!.size;
    if (size > lim.maxImageBytes) throw new VlmEvalSetError(`${p} is larger than ${mb(lim.maxImageBytes)}`, 413);
    declared += size;
  }
  if (declared > lim.maxBytes) throw new VlmEvalSetError(`The images add up to more than ${mb(lim.maxBytes)}`, 413);

  // 4. Written into a scratch folder first, then renamed into place.
  await fs.mkdir(root(), { recursive: true });
  const tmp = path.join(root(), `.tmp-${crypto.randomUUID()}`);
  try {
    let total = 0;
    for (const p of used) {
      const zipName = inZip.get(p)!.zipName;
      const bytes = extractZip(input.zip, [zipName])[zipName];
      if (!bytes) throw new VlmEvalSetError(`${p} could not be read from the ZIP`);
      // The size in a ZIP header is a claim; what came out is the fact.
      if (bytes.byteLength > lim.maxImageBytes) throw new VlmEvalSetError(`${p} is larger than ${mb(lim.maxImageBytes)}`, 413);
      total += bytes.byteLength;
      if (total > lim.maxBytes) throw new VlmEvalSetError(`The images add up to more than ${mb(lim.maxBytes)}`, 413);
      const sniffed = sniffImageMime(bytes);
      if (!sniffed) throw new VlmEvalSetError(`${p} is not a png, jpeg or webp image`);
      if (sniffed !== mimeForPath(p)) throw new VlmEvalSetError(`${p} is a ${sniffed.slice(6)} image, but its name says otherwise`);
      const dest = imagePath(tmp, p);
      if (!dest) throw new VlmEvalSetError(`${p} is not a valid image path`);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, bytes);
    }
    const set: VlmEvalSet = { id, name, scoring, rows: rows.length, images: used.length, source: "upload", createdAt: Date.now() };
    await atomicWrite(path.join(tmp, "rows.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    await atomicWrite(path.join(tmp, "meta.json"), JSON.stringify(set));
    try {
      await fs.rename(tmp, setDir(id));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // Another upload with the same name won the race.
      if (code === "EEXIST" || code === "ENOTEMPTY") throw new VlmEvalSetError(`A test set named "${id}" already exists. Use another name or delete it first.`, 409);
      throw err;
    }
    return set;
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** `<base>/images/...` for a validated relative image path, or null when it would leave `<base>/images`. */
function imagePath(base: string, relpath: string): string | null {
  if (imageRelpathProblem(relpath) !== null) return null;
  const imagesRoot = path.resolve(base, "images");
  const full = path.resolve(base, relpath);
  return full.startsWith(imagesRoot + path.sep) ? full : null;
}

export async function listVlmEvalSets(): Promise<VlmEvalSet[]> {
  let names: string[];
  try {
    names = await fs.readdir(root());
  } catch {
    return [];
  }
  const sets: VlmEvalSet[] = [];
  for (const n of names) {
    if (!ID.test(n)) continue; // scratch folders (.tmp-*) and strangers
    try {
      sets.push(JSON.parse(await fs.readFile(path.join(root(), n, "meta.json"), "utf8")) as VlmEvalSet);
    } catch {
      /* a folder without a readable meta.json is not a set */
    }
  }
  return sets.sort((a, b) => b.createdAt - a.createdAt);
}

/** Throws `VlmEvalSetError` for an invalid id (callers answer 400); null when there is no such set. */
export async function getVlmEvalSet(id: string): Promise<VlmEvalSet | null> {
  checkId(id);
  try {
    return JSON.parse(await fs.readFile(path.join(setDir(id), "meta.json"), "utf8")) as VlmEvalSet;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error("[vlm-eval-sets] read failed:", err);
    return null;
  }
}

/** Every row of a set, in order. Null when the set does not exist. */
export async function readVlmEvalRows(id: string): Promise<VlmEvalRow[] | null> {
  checkId(id);
  try {
    const text = await fs.readFile(path.join(setDir(id), "rows.jsonl"), "utf8");
    return text
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as VlmEvalRow);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error("[vlm-eval-sets] rows read failed:", err);
    return null;
  }
}

/**
 * One stored image. `relpath` is checked like an upload's (under `images/`, no `..`, png/jpeg/webp) and
 * resolved inside the set's own folder; the type comes from the bytes. Null when it is not there or not an image.
 */
export async function readVlmEvalImage(id: string, relpath: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  checkId(id);
  const file = imagePath(setDir(id), relpath);
  if (!file) return null;
  try {
    const st = await fs.lstat(file);
    if (!st.isFile()) return null;
    const bytes = new Uint8Array(await fs.readFile(file));
    const mime = sniffImageMime(bytes);
    return mime ? { bytes, mime } : null;
  } catch {
    return null;
  }
}

export async function deleteVlmEvalSet(id: string): Promise<void> {
  checkId(id);
  await fs.rm(setDir(id), { recursive: true, force: true });
}
