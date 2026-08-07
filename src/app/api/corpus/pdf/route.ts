import type { NextRequest } from "next/server";

import { logServerError } from "@/lib/log";
import { allowedBuckets, fetchObject, s3Configured } from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stream a PDF (or any object) out of an allowed S3 bucket so the browser can
 * view it inline — MinIO is internal, so this proxies the bytes through Next.
 * `?bucket=&key=`. Served `inline` for the built-in browser PDF viewer.
 */
export async function GET(req: NextRequest) {
  if (!s3Configured()) {
    return Response.json({ error: "S3 is not configured." }, { status: 400 });
  }
  const bucket = req.nextUrl.searchParams.get("bucket")?.trim() || "";
  const key = req.nextUrl.searchParams.get("key")?.trim().replace(/^\/+/, "") || "";
  if (!bucket || !key) {
    return Response.json({ error: "`bucket` and `key` are required." }, { status: 400 });
  }
  if (!allowedBuckets().includes(bucket)) {
    return Response.json({ error: `Bucket "${bucket}" is not allowed.` }, { status: 400 });
  }
  try {
    const res = await fetchObject(bucket, key);
    if (!res.ok || !res.body) {
      return Response.json({ error: `Could not read s3://${bucket}/${key} (${res.status}).` }, { status: 502 });
    }
    const isPdf = /\.pdf$/i.test(key);
    const name = key.split("/").pop() || "file";
    return new Response(res.body, {
      headers: {
        "content-type": isPdf ? "application/pdf" : res.headers.get("content-type") || "application/octet-stream",
        "content-disposition": `inline; filename="${name.replace(/"/g, "")}"`,
        "cache-control": "private, max-age=60",
      },
    });
  } catch (err) {
    logServerError("corpus/pdf", err);
    return Response.json({ error: "Could not stream the object." }, { status: 502 });
  }
}
