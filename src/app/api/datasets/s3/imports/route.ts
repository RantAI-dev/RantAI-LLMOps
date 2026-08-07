import type { NextRequest } from "next/server";

import { logServerError } from "@/lib/log";
import { s3Configured } from "@/lib/s3";
import {
  importS3Datasets,
  listImportedS3Datasets,
  parseS3Ref,
  removeImportedS3Dataset,
  type ImportItem,
} from "@/lib/s3-datasets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List the S3 datasets registered in the manifest. */
export async function GET() {
  try {
    const datasets = await listImportedS3Datasets();
    return Response.json({ datasets });
  } catch (err) {
    logServerError("datasets/s3/imports GET", err);
    return Response.json({ datasets: [] });
  }
}

type PostBody = {
  /** Explicit objects to import… */
  items?: ImportItem[];
  /** …or raw `s3://bucket/key` refs (the "link to S3" paste path). */
  refs?: string[];
};

/** Import (register) one or more S3 datasets by reference. */
export async function POST(req: NextRequest) {
  if (!s3Configured()) {
    return Response.json({ error: "S3/MinIO is not configured." }, { status: 400 });
  }
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const items: ImportItem[] = [...(body.items ?? [])];
  for (const ref of body.refs ?? []) {
    try {
      const { bucket, key } = parseS3Ref(ref);
      items.push({ bucket, key });
    } catch {
      return Response.json({ error: `Invalid reference: ${ref}` }, { status: 400 });
    }
  }
  if (items.length === 0) {
    return Response.json({ error: "Nothing to import." }, { status: 400 });
  }
  try {
    const datasets = await importS3Datasets(items);
    return Response.json({ datasets });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not import dataset(s).";
    return Response.json({ error: message }, { status: 400 });
  }
}

/** Remove an import from the manifest (leaves the S3 object untouched). */
export async function DELETE(req: NextRequest) {
  const ref = req.nextUrl.searchParams.get("ref")?.trim();
  if (!ref) return Response.json({ error: "`ref` is required" }, { status: 400 });
  try {
    const datasets = await removeImportedS3Dataset(ref);
    return Response.json({ datasets });
  } catch (err) {
    logServerError("datasets/s3/imports DELETE", err);
    return Response.json({ error: "Could not remove the import." }, { status: 502 });
  }
}
