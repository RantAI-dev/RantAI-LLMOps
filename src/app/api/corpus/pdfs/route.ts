import type { NextRequest } from "next/server";

import { logServerError } from "@/lib/log";
import { allowedBuckets, listAllPdfs, s3Configured } from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * All `.pdf` keys under `?prefix=` (recursive) in an allowed bucket — used to add
 * a whole folder of source PDFs to the processing pool in one click.
 */
export async function GET(req: NextRequest) {
  if (!s3Configured()) return Response.json({ configured: false, keys: [] });
  const bucket = req.nextUrl.searchParams.get("bucket")?.trim() || "";
  const prefix = req.nextUrl.searchParams.get("prefix")?.trim() || "";
  if (!bucket) return Response.json({ error: "`bucket` is required." }, { status: 400 });
  if (!allowedBuckets().includes(bucket)) {
    return Response.json({ error: `Bucket "${bucket}" is not allowed.` }, { status: 400 });
  }
  try {
    const keys = await listAllPdfs(bucket, prefix);
    return Response.json({ configured: true, bucket, prefix, keys });
  } catch (err) {
    logServerError("corpus/pdfs", err);
    return Response.json({ error: "Could not list PDFs." }, { status: 502 });
  }
}
