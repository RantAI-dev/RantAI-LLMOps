/**
 * Registry of imported S3 dataset *references* — the "load a dataset from S3"
 * feature.
 *
 * The design decision (agreed with Harpun): importing an S3 dataset must NOT
 * copy it onto TL disk — that would duplicate potentially large corpora. So an
 * import records only an `s3://bucket/key` reference plus a little metadata in a
 * small JSON manifest kept in S3 itself (`_dataset-imports.json`). The trainer
 * resolves the `s3://` URI at run time, exactly like a dataset created straight
 * to S3.
 *
 * The manifest lives in S3 (not localStorage / not a container file) so the list
 * is shared across browsers/devices and survives a container rebuild — the box
 * keeps its own catalog.
 */
import {
  allowedBuckets,
  assertAllowedBucket,
  getDatasetObjectText,
  getObjectMaybe,
  listDatasetObjects,
  objectExists,
  probePrefix,
  putObject,
  s3Configured,
} from "@/lib/s3";

/**
 * A manifest entry is a single dataset file, a whole prefix/bucket of datasets
 * ("folder"), or a prefix/bucket of raw source files like PDFs ("corpus") — a
 * source that feeds the augmentation pipeline, not something trained directly.
 */
export type S3EntryFormat = "jsonl" | "csv" | "folder" | "corpus";

const MANIFEST_KEY = "_dataset-imports.json";

/** Bucket that holds the manifest. Defaults to `datasets` when allowed, else the
 *  first allowed bucket (so it works even on a single-bucket setup). */
function manifestBucket(): string {
  const explicit = (process.env.DATASET_MANIFEST_BUCKET || "").trim();
  const allowed = allowedBuckets();
  if (explicit) return explicit;
  if (allowed.includes("datasets")) return "datasets";
  return allowed[0] ?? "datasets";
}

export type S3DatasetEntry = {
  /** Canonical reference — a single object `s3://bucket/key`, or a whole
   *  prefix/bucket `s3://bucket/` (trailing slash). Also the Fine-tune id. */
  ref: string;
  bucket: string;
  /** Object key for a file; the prefix (may be "") for a folder/bucket. */
  key: string;
  /** Friendly display name (defaults to the file name / bucket name). */
  name: string;
  format: S3EntryFormat;
  sizeKb: number | null;
  importedAt: string;
};

export type ImportItem = { bucket: string; key: string; name?: string; sizeKb?: number | null };

/** `s3://bucket/key` → `{ bucket, key }`. A bare `s3://bucket` or `s3://bucket/`
 *  yields an empty key (whole-bucket reference). Throws on a malformed ref. */
export function parseS3Ref(ref: string): { bucket: string; key: string } {
  const m = /^s3:\/\/([^/]+)(?:\/(.*))?$/.exec(ref.trim());
  if (!m) throw new Error(`Not an s3:// reference: ${ref}`);
  return { bucket: m[1], key: m[2] ?? "" };
}

/** A folder/bucket import is a bare bucket ("") or a key ending in "/". */
function isPrefixKey(key: string): boolean {
  return key === "" || key.endsWith("/");
}

function formatOf(key: string): S3EntryFormat {
  if (isPrefixKey(key)) return "folder";
  return /\.csv$/i.test(key) ? "csv" : "jsonl";
}

async function readManifest(): Promise<S3DatasetEntry[]> {
  if (!s3Configured()) return [];
  const bucket = manifestBucket();
  assertAllowedBucket(bucket);
  const text = await getObjectMaybe(bucket, MANIFEST_KEY);
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as { datasets?: S3DatasetEntry[] };
    return Array.isArray(parsed.datasets) ? parsed.datasets : [];
  } catch {
    // A corrupt manifest shouldn't take the whole library down — start clean.
    return [];
  }
}

async function writeManifest(datasets: S3DatasetEntry[]): Promise<void> {
  const bucket = manifestBucket();
  assertAllowedBucket(bucket);
  const body = JSON.stringify({ version: 1, datasets }, null, 2);
  await putObject(bucket, MANIFEST_KEY, body, "application/json");
}

/** All imported S3 datasets, newest first. */
export async function listImportedS3Datasets(): Promise<S3DatasetEntry[]> {
  const datasets = await readManifest();
  return [...datasets].sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1));
}

/**
 * Record one or more `s3://` datasets in the manifest (idempotent by ref). Each
 * item is validated to actually exist and sit in an allowed bucket before it's
 * added — so the library never lists a dead reference. Returns the full updated
 * list. `.jsonl` / `.csv` only.
 */
export async function importS3Datasets(items: ImportItem[]): Promise<S3DatasetEntry[]> {
  if (!s3Configured()) throw new Error("S3 is not configured.");
  const existing = await readManifest();
  const byRef = new Map(existing.map((d) => [d.ref, d]));
  const now = new Date().toISOString();

  for (const item of items) {
    const bucket = item.bucket.trim();
    const key = item.key.trim().replace(/^\/+/, "");
    if (!bucket) throw new Error("Each item needs a bucket.");
    assertAllowedBucket(bucket);

    let ref: string;
    let name: string;
    let format: S3EntryFormat;
    if (isPrefixKey(key)) {
      // Whole prefix / bucket. Any non-empty folder can be registered: if it holds
      // .jsonl/.csv it's a trainable "folder"; otherwise (e.g. PDFs) it's a
      // "corpus" source for the augmentation pipeline. Trailing-slash ref = load
      // everything under it.
      const probe = await probePrefix(bucket, key);
      if (probe.total === 0) {
        throw new Error(`s3://${bucket}/${key} is empty — nothing to import.`);
      }
      format = probe.datasets > 0 ? "folder" : "corpus";
      ref = `s3://${bucket}/${key}`;
      const label = key ? key.replace(/\/$/, "").split("/").pop() || key : bucket;
      name = (item.name?.trim() || label).slice(0, 120);
    } else {
      if (key.startsWith("_") || !/\.(jsonl|csv)$/i.test(key)) {
        throw new Error(`Only .jsonl / .csv datasets can be imported (got "${key}").`);
      }
      if (!(await objectExists(bucket, key))) {
        throw new Error(`s3://${bucket}/${key} does not exist.`);
      }
      format = formatOf(key);
      ref = `s3://${bucket}/${key}`;
      name = (item.name?.trim() || key.split("/").pop() || key).slice(0, 120);
    }

    byRef.set(ref, {
      ref,
      bucket,
      key,
      name,
      format,
      sizeKb: item.sizeKb ?? byRef.get(ref)?.sizeKb ?? null,
      importedAt: byRef.get(ref)?.importedAt ?? now,
    });
  }

  const merged = [...byRef.values()];
  await writeManifest(merged);
  return merged;
}

export type S3DatasetSummary = { files: number; rows: number; sizeKb: number; capped: boolean };

// Bounds so counting rows for a huge corpus can't stall the Library listing.
const SUMMARY_MAX_FILES = 200;
const SUMMARY_MAX_BYTES = 64 * 1024 * 1024;

/** Non-empty JSONL lines, or CSV data rows (minus the header). */
function countRows(text: string, csv: boolean): number {
  let n = 0;
  for (const line of text.split("\n")) if (line.trim()) n += 1;
  return csv ? Math.max(0, n - 1) : n;
}

/**
 * Real file + row counts for a manifest entry, so the Library card reflects what
 * actually loaded instead of a hardcoded 0. A folder/bucket ref sums the loadable
 * `.jsonl`/`.csv` shards under it (including generated chunks under `_processed/`,
 * whose file names aren't `_`-hidden); a single-file ref counts that file. Bounded
 * by file count and total bytes — `capped` marks a lower-bound when the cap is hit.
 */
export async function summarizeS3Dataset(
  entry: Pick<S3DatasetEntry, "bucket" | "key">
): Promise<S3DatasetSummary> {
  const { bucket, key } = entry;
  const shards = isPrefixKey(key)
    ? (await listDatasetObjects(bucket, key)).map((o) => ({ key: o.key, csv: o.format === "csv" }))
    : [{ key, csv: /\.csv$/i.test(key) }];

  let files = 0;
  let rows = 0;
  let bytes = 0;
  let capped = false;
  for (const shard of shards) {
    if (files >= SUMMARY_MAX_FILES || bytes >= SUMMARY_MAX_BYTES) {
      capped = true;
      break;
    }
    try {
      const text = await getDatasetObjectText(bucket, shard.key);
      rows += countRows(text, shard.csv);
      bytes += text.length;
      files += 1;
    } catch {
      capped = true; // unreadable shard — count stays a lower bound
    }
  }
  return { files, rows, sizeKb: Math.round(bytes / 1024), capped };
}

/** Remove an import from the manifest (does NOT delete the S3 object itself). */
export async function removeImportedS3Dataset(ref: string): Promise<S3DatasetEntry[]> {
  const existing = await readManifest();
  const next = existing.filter((d) => d.ref !== ref);
  if (next.length !== existing.length) await writeManifest(next);
  return next;
}
