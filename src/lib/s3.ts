/**
 * Server-only S3 / MinIO reader for grounding eval sets.
 *
 * The meeting agreed the grounded evaluation runs on the real Eval Set, and the
 * plan is to keep that data in S3 (MinIO on the box) rather than pass it through
 * a browser upload every time. This lets a route list the `.jsonl` eval sets in
 * a bucket and read one by key.
 *
 * Credentials + endpoint come from the same env the trainer already uses to pull
 * `s3://` datasets (S3_ENDPOINT_URL, AWS_ACCESS_KEY_ID, …), so a corpus that must
 * stay on-premise never leaves the box. Signing is delegated to `aws4fetch`
 * (SigV4) — the part that is easy to get subtly wrong.
 */
import { AwsClient } from "aws4fetch";

const ENDPOINT = (process.env.S3_ENDPOINT_URL ?? "").replace(/\/$/, "");
const REGION = process.env.AWS_REGION || "us-east-1";
const ACCESS_KEY = process.env.AWS_ACCESS_KEY_ID ?? "";
const SECRET_KEY = process.env.AWS_SECRET_ACCESS_KEY ?? "";
/** Default bucket for eval sets; overridable so a team can point elsewhere. */
export const EVAL_SET_BUCKET = process.env.EVAL_SET_BUCKET || "eval-sets";

/**
 * Buckets this reader is allowed to touch. `bucket` reaches here from a client
 * query param, so without an allowlist an authenticated user could read ANY
 * object these S3 creds can reach (the same creds the trainer uses for private
 * corpora). Defaults to the eval-set bucket; set `S3_ALLOWED_BUCKETS` (comma-
 * separated) to also browse others, e.g. `S3_ALLOWED_BUCKETS=eval-sets,sft`.
 */
const ALLOWED_BUCKETS = new Set(
  (process.env.S3_ALLOWED_BUCKETS || EVAL_SET_BUCKET)
    .split(",")
    .map((b) => b.trim())
    .filter(Boolean)
);

/** Guard: reject a bucket that isn't explicitly allowed. */
export function assertAllowedBucket(bucket: string): void {
  if (!ALLOWED_BUCKETS.has(bucket)) {
    throw new Error(`Bucket "${bucket}" is not allowed. Set S3_ALLOWED_BUCKETS to permit it.`);
  }
}

/** Whether S3 is configured enough to attempt a call. */
export function s3Configured(): boolean {
  return Boolean(ENDPOINT && ACCESS_KEY && SECRET_KEY);
}

/** Config the UI needs to offer an S3 destination: is it usable, and where. */
export function s3Config(): { configured: boolean; buckets: string[]; defaultBucket: string } {
  const buckets = [...ALLOWED_BUCKETS];
  return {
    configured: s3Configured(),
    buckets,
    defaultBucket: buckets[0] ?? EVAL_SET_BUCKET,
  };
}

/**
 * Upload an object (used to save a user-authored dataset straight to S3, so the
 * trainer can pull it by `s3://` URI — a corpus/dataset never leaves the box).
 * Returns the canonical `s3://bucket/key` reference. Same allowlist guard as the
 * readers: `bucket` must be permitted, so these creds can't be aimed anywhere.
 */
export async function putObject(
  bucket: string,
  key: string,
  body: string | Uint8Array<ArrayBuffer>,
  contentType = "application/jsonl"
): Promise<string> {
  if (!s3Configured()) {
    throw new Error("S3 is not configured (S3_ENDPOINT_URL / credentials are not set).");
  }
  assertAllowedBucket(bucket);
  // Encode to bytes and set Content-Length explicitly. Some S3-compatible servers
  // (e.g. RustFS) reject a length-less/chunked PUT with 411 MissingContentLength,
  // which is what a plain string body produces once aws4fetch re-wraps it.
  // Binary bodies (a raw PDF kept in the corpus bucket) pass through as-is.
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  const res = await client().fetch(objectUrl(bucket, key), {
    method: "PUT",
    body: bytes,
    headers: { "content-type": contentType, "content-length": String(bytes.byteLength) },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Failed to upload to S3 (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return `s3://${bucket}/${key}`;
}

function client(): AwsClient {
  return new AwsClient({
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
    region: REGION,
    service: "s3",
  });
}

/** MinIO is path-style (`endpoint/bucket/key`), not virtual-host style. */
function objectUrl(bucket: string, key: string): string {
  return `${ENDPOINT}/${encodeURIComponent(bucket)}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export type S3EvalSet = { key: string; name: string; sizeKb: number | null };

/** Decode the five predefined XML entities in text captured from the list XML.
 *  `&amp;` last so an already-decoded `&` isn't re-interpreted. */
function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * List the `.jsonl` objects in a bucket (optionally under a prefix) — the eval
 * sets a user can pick. Uses ListObjectsV2 and reads the XML with a small regex
 * rather than pulling in an XML parser for three fields.
 */
export async function listEvalSets(bucket = EVAL_SET_BUCKET, prefix = ""): Promise<S3EvalSet[]> {
  if (!s3Configured()) return [];
  assertAllowedBucket(bucket);
  const out: S3EvalSet[] = [];
  // ListObjectsV2 caps a page at 1000 keys; follow NextContinuationToken so a
  // bucket with more than one page isn't silently truncated to the first 1000.
  let token: string | undefined;
  do {
    const q = new URLSearchParams({ "list-type": "2", "max-keys": "1000" });
    if (prefix) q.set("prefix", prefix);
    if (token) q.set("continuation-token", token);
    const res = await client().fetch(`${ENDPOINT}/${encodeURIComponent(bucket)}?${q}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`S3 list failed (${res.status})`);
    const xml = await res.text();
    // <Contents><Key>…</Key><Size>…</Size></Contents>
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const block = m[1];
      const rawKey = /<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1];
      const key = rawKey === undefined ? undefined : unescapeXml(rawKey);
      if (!key || !/\.jsonl$/i.test(key)) continue;
      const size = Number(/<Size>(\d+)<\/Size>/.exec(block)?.[1] ?? "");
      out.push({
        key,
        name: key.split("/").pop() ?? key,
        sizeKb: Number.isFinite(size) ? Math.round(size / 1024) : null,
      });
    }
    const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
    const rawToken = truncated
      ? /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1]
      : undefined;
    token = rawToken === undefined ? undefined : unescapeXml(rawToken);
  } while (token);
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Read one eval set's JSONL text by key. */
export async function getEvalSetText(key: string, bucket = EVAL_SET_BUCKET): Promise<string> {
  if (!s3Configured()) throw new Error("S3 is not configured (S3_ENDPOINT_URL / credentials are not set).");
  assertAllowedBucket(bucket);
  // Only eval sets (.jsonl) are readable — the listing already filters to these,
  // so this stops the read path being used to fetch arbitrary objects by key.
  if (!/\.jsonl$/i.test(key)) throw new Error("Only .jsonl eval sets can be read.");
  const res = await client().fetch(objectUrl(bucket, key), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Failed to read ${key} from S3 (${res.status})`);
  return res.text();
}

// ---------------------------------------------------------------------------
// Generic dataset objects (browse + import an existing S3 dataset by ref).
//
// Unlike the eval-set path (locked to .jsonl in the eval bucket), a training
// dataset can live in ANY allowed bucket as .jsonl or .csv. Nothing here copies
// data — the browse/import flow only records an `s3://bucket/key` reference the
// trainer resolves at run time, so a corpus never leaves the box and never gets
// duplicated onto TL disk.
// ---------------------------------------------------------------------------

export type S3DatasetFormat = "jsonl" | "csv";
export type S3Object = { key: string; name: string; sizeKb: number | null; format: S3DatasetFormat };

/** Broader format tag for the file *browser* (source picking can be any file). */
export type S3FileFormat = S3DatasetFormat | "pdf" | "other";
export type S3Entry = { key: string; name: string; sizeKb: number | null; format: S3FileFormat };
export type S3Folder = { prefix: string; name: string };

function fileFormat(key: string): S3FileFormat {
  if (/\.jsonl$/i.test(key)) return "jsonl";
  if (/\.csv$/i.test(key)) return "csv";
  if (/\.pdf$/i.test(key)) return "pdf";
  return "other";
}

/** True for the two formats that can actually be loaded/imported as a dataset. */
export function isDatasetFormat(format: S3FileFormat): format is S3DatasetFormat {
  return format === "jsonl" || format === "csv";
}

/** The buckets the UI is allowed to browse (from `S3_ALLOWED_BUCKETS`). */
export function allowedBuckets(): string[] {
  return [...ALLOWED_BUCKETS];
}

function datasetFormat(key: string): S3DatasetFormat | null {
  if (/\.jsonl$/i.test(key)) return "jsonl";
  if (/\.csv$/i.test(key)) return "csv";
  return null;
}

/**
 * List the dataset objects (`.jsonl` / `.csv`) in an allowed bucket. Hidden keys
 * (a leading `_`, e.g. the import manifest) are skipped so the manifest doesn't
 * show up as a pickable dataset. Same ListObjectsV2 pagination as `listEvalSets`.
 */
export async function listDatasetObjects(bucket: string, prefix = ""): Promise<S3Object[]> {
  if (!s3Configured()) return [];
  assertAllowedBucket(bucket);
  const out: S3Object[] = [];
  let token: string | undefined;
  do {
    const q = new URLSearchParams({ "list-type": "2", "max-keys": "1000" });
    if (prefix) q.set("prefix", prefix);
    if (token) q.set("continuation-token", token);
    const res = await client().fetch(`${ENDPOINT}/${encodeURIComponent(bucket)}?${q}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`S3 list failed (${res.status})`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const block = m[1];
      const rawKey = /<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1];
      const key = rawKey === undefined ? undefined : unescapeXml(rawKey);
      if (!key) continue;
      const base = key.split("/").pop() ?? key;
      if (base.startsWith("_")) continue; // hidden (manifest, internal)
      const format = datasetFormat(key);
      if (!format) continue;
      const size = Number(/<Size>(\d+)<\/Size>/.exec(block)?.[1] ?? "");
      out.push({
        key,
        name: base,
        sizeKb: Number.isFinite(size) ? Math.round(size / 1024) : null,
        format,
      });
    }
    const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
    const rawToken = truncated
      ? /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1]
      : undefined;
    token = rawToken === undefined ? undefined : unescapeXml(rawToken);
  } while (token);
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Browse a bucket like a file tree: ALL files (any format) + sub-folders under
 * `prefix`, one level deep (delimiter `/`). Unlike `listDatasetObjects` this does
 * not filter to `.jsonl`/`.csv` — the source of an augmentation run is PDFs, and
 * format only matters later at load time. Hidden `_`-prefixed keys are skipped.
 */
export async function listBucketEntries(
  bucket: string,
  prefix = ""
): Promise<{ folders: S3Folder[]; objects: S3Entry[] }> {
  if (!s3Configured()) return { folders: [], objects: [] };
  assertAllowedBucket(bucket);
  const folders: S3Folder[] = [];
  const objects: S3Entry[] = [];
  let token: string | undefined;
  do {
    const q = new URLSearchParams({ "list-type": "2", "max-keys": "1000", delimiter: "/" });
    if (prefix) q.set("prefix", prefix);
    if (token) q.set("continuation-token", token);
    const res = await client().fetch(`${ENDPOINT}/${encodeURIComponent(bucket)}?${q}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`S3 list failed (${res.status})`);
    const xml = await res.text();
    // Sub-folders (CommonPrefixes when a delimiter is set).
    for (const m of xml.matchAll(/<CommonPrefixes>[\s\S]*?<Prefix>([\s\S]*?)<\/Prefix>[\s\S]*?<\/CommonPrefixes>/g)) {
      const raw = m[1] === undefined ? undefined : unescapeXml(m[1]);
      if (!raw) continue;
      const name = raw.replace(/\/$/, "").split("/").pop() ?? raw;
      if (name.startsWith("_")) continue;
      folders.push({ prefix: raw, name });
    }
    // Files directly under this prefix.
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const block = m[1];
      const rawKey = /<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1];
      const key = rawKey === undefined ? undefined : unescapeXml(rawKey);
      if (!key || key === prefix) continue; // the folder placeholder itself
      const base = key.split("/").pop() ?? key;
      if (!base || base.startsWith("_")) continue;
      const size = Number(/<Size>(\d+)<\/Size>/.exec(block)?.[1] ?? "");
      objects.push({
        key,
        name: base,
        sizeKb: Number.isFinite(size) ? Math.round(size / 1024) : null,
        format: fileFormat(key),
      });
    }
    const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
    const rawToken = truncated
      ? /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1]
      : undefined;
    token = rawToken === undefined ? undefined : unescapeXml(rawToken);
  } while (token);
  folders.sort((a, b) => a.name.localeCompare(b.name));
  objects.sort((a, b) => a.name.localeCompare(b.name));
  return { folders, objects };
}

/**
 * Cheap probe of what lives under a prefix (recursive, first page only): how many
 * non-hidden files total, and how many are loadable datasets (`.jsonl`/`.csv`).
 * Used to classify a folder import — a PDF-only folder is a *corpus source*, not a
 * trainable dataset. `total` is capped at one 1000-key page (enough to classify).
 */
export async function probePrefix(
  bucket: string,
  prefix = ""
): Promise<{ total: number; datasets: number; sample: string[] }> {
  if (!s3Configured()) return { total: 0, datasets: 0, sample: [] };
  assertAllowedBucket(bucket);
  const q = new URLSearchParams({ "list-type": "2", "max-keys": "1000" });
  if (prefix) q.set("prefix", prefix);
  const res = await client().fetch(`${ENDPOINT}/${encodeURIComponent(bucket)}?${q}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`S3 list failed (${res.status})`);
  const xml = await res.text();
  let total = 0;
  let datasets = 0;
  const sample: string[] = [];
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const rawKey = /<Key>([\s\S]*?)<\/Key>/.exec(m[1])?.[1];
    const key = rawKey === undefined ? undefined : unescapeXml(rawKey);
    if (!key || key === prefix) continue;
    const base = key.split("/").pop() ?? key;
    if (!base || base.startsWith("_")) continue;
    total += 1;
    if (datasetFormat(key)) datasets += 1;
    if (sample.length < 5) sample.push(base);
  }
  return { total, datasets, sample };
}

/**
 * List every `.pdf` key under a prefix, recursively (no delimiter). Used to add a
 * whole folder of source PDFs to the processing pool. Hidden `_`-prefixed keys
 * are skipped. Paginates through the full listing.
 */
export async function listAllPdfs(bucket: string, prefix = ""): Promise<string[]> {
  if (!s3Configured()) return [];
  assertAllowedBucket(bucket);
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const q = new URLSearchParams({ "list-type": "2", "max-keys": "1000" });
    if (prefix) q.set("prefix", prefix);
    if (token) q.set("continuation-token", token);
    const res = await client().fetch(`${ENDPOINT}/${encodeURIComponent(bucket)}?${q}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`S3 list failed (${res.status})`);
    const xml = await res.text();
    for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const rawKey = /<Key>([\s\S]*?)<\/Key>/.exec(m[1])?.[1];
      const key = rawKey === undefined ? undefined : unescapeXml(rawKey);
      if (!key || !/\.pdf$/i.test(key)) continue;
      const base = key.split("/").pop() ?? key;
      if (base.startsWith("_")) continue;
      keys.push(key);
    }
    const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
    const rawToken = truncated
      ? /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1]
      : undefined;
    token = rawToken === undefined ? undefined : unescapeXml(rawToken);
  } while (token);
  return keys.sort((a, b) => a.localeCompare(b));
}

/**
 * Raw object fetch — returns the underlying S3 `Response` so a route can stream
 * the body straight to the browser (e.g. a PDF viewer). MinIO is internal, so the
 * browser can't reach it directly; this proxies it through the Next server.
 */
export async function fetchObject(bucket: string, key: string): Promise<Response> {
  if (!s3Configured()) throw new Error("S3 is not configured (S3_ENDPOINT_URL / credentials are not set).");
  assertAllowedBucket(bucket);
  return client().fetch(objectUrl(bucket, key), { signal: AbortSignal.timeout(30000) });
}

/** Whether an object exists (used to validate an import before recording it). */
export async function objectExists(bucket: string, key: string): Promise<boolean> {
  if (!s3Configured()) return false;
  assertAllowedBucket(bucket);
  const res = await client().fetch(objectUrl(bucket, key), {
    method: "HEAD",
    signal: AbortSignal.timeout(8000),
  });
  return res.ok;
}

/** Read a dataset object (`.jsonl` / `.csv`) by key — for the preview tab. */
export async function getDatasetObjectText(bucket: string, key: string): Promise<string> {
  if (!s3Configured()) throw new Error("S3 is not configured (S3_ENDPOINT_URL / credentials are not set).");
  assertAllowedBucket(bucket);
  if (!datasetFormat(key)) throw new Error("Only .jsonl / .csv datasets can be read.");
  const res = await client().fetch(objectUrl(bucket, key), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Failed to read ${key} from S3 (${res.status})`);
  return res.text();
}

/** Read an object's text if present; `null` on 404. Used for the JSON manifest. */
export async function getObjectMaybe(bucket: string, key: string): Promise<string | null> {
  if (!s3Configured()) return null;
  assertAllowedBucket(bucket);
  const res = await client().fetch(objectUrl(bucket, key), { signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to read ${key} from S3 (${res.status})`);
  return res.text();
}
