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
  body: string,
  contentType = "application/jsonl"
): Promise<string> {
  if (!s3Configured()) {
    throw new Error("S3 is not configured (S3_ENDPOINT_URL / credentials are not set).");
  }
  assertAllowedBucket(bucket);
  const res = await client().fetch(objectUrl(bucket, key), {
    method: "PUT",
    body,
    headers: { "content-type": contentType },
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
