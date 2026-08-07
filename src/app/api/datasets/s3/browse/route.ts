import type { NextRequest } from "next/server";

import { logServerError } from "@/lib/log";
import { allowedBuckets, listBucketEntries, s3Configured } from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Browse an allowed S3 bucket like a file tree: ALL files (any format) plus
 * sub-folders under `?prefix=`. Source picking for an augmentation run is PDFs,
 * so this is deliberately not limited to `.jsonl`/`.csv`; format only constrains
 * what can be *imported/loaded* later. `?bucket=` chooses the bucket (defaults to
 * the first allowed one); `?prefix=` navigates into a folder.
 */
export async function GET(req: NextRequest) {
  const buckets = allowedBuckets();
  if (!s3Configured()) {
    return Response.json({ configured: false, buckets, bucket: null, objects: [] });
  }
  const requested = req.nextUrl.searchParams.get("bucket")?.trim();
  const bucket = requested || buckets[0];
  if (!bucket) {
    return Response.json({ configured: true, buckets, bucket: null, objects: [] });
  }
  if (!buckets.includes(bucket)) {
    return Response.json({ error: `Bucket "${bucket}" is not allowed.` }, { status: 400 });
  }
  const prefix = req.nextUrl.searchParams.get("prefix")?.trim() || "";
  try {
    const { folders, objects } = await listBucketEntries(bucket, prefix);
    return Response.json({ configured: true, buckets, bucket, prefix, folders, objects });
  } catch (err) {
    logServerError("datasets/s3/browse", err);
    return Response.json({ error: "Could not list the bucket." }, { status: 502 });
  }
}
