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

/** Whether S3 is configured enough to attempt a call. */
export function s3Configured(): boolean {
  return Boolean(ENDPOINT && ACCESS_KEY && SECRET_KEY);
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

/**
 * List the `.jsonl` objects in a bucket (optionally under a prefix) — the eval
 * sets a user can pick. Uses ListObjectsV2 and reads the XML with a small regex
 * rather than pulling in an XML parser for three fields.
 */
export async function listEvalSets(bucket = EVAL_SET_BUCKET, prefix = ""): Promise<S3EvalSet[]> {
  if (!s3Configured()) return [];
  const q = new URLSearchParams({ "list-type": "2", "max-keys": "1000" });
  if (prefix) q.set("prefix", prefix);
  const res = await client().fetch(`${ENDPOINT}/${encodeURIComponent(bucket)}?${q}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`S3 list gagal (${res.status})`);
  const xml = await res.text();
  const out: S3EvalSet[] = [];
  // <Contents><Key>…</Key><Size>…</Size></Contents>
  for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
    const block = m[1];
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1];
    if (!key || !/\.jsonl$/i.test(key)) continue;
    const size = Number(/<Size>(\d+)<\/Size>/.exec(block)?.[1] ?? "");
    out.push({
      key,
      name: key.split("/").pop() ?? key,
      sizeKb: Number.isFinite(size) ? Math.round(size / 1024) : null,
    });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Read one eval set's JSONL text by key. */
export async function getEvalSetText(key: string, bucket = EVAL_SET_BUCKET): Promise<string> {
  if (!s3Configured()) throw new Error("S3 belum dikonfigurasi (S3_ENDPOINT_URL / kredensial belum diset).");
  const res = await client().fetch(objectUrl(bucket, key), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Gagal membaca ${key} dari S3 (${res.status})`);
  return res.text();
}
