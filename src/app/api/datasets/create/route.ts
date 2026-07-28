import type { NextRequest } from "next/server";

import { createDataset, createDatasetOnS3 } from "@/lib/finetune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  name?: string;
  rows?: Array<{ prompt?: string; completion?: string }>;
  /** Save to S3/MinIO at `s3://<bucket>/<prefix>/<id>/train.jsonl`. When set, the
   *  dataset is trainable by `s3://` URI (a TL-local dataset is not). */
  bucket?: string;
  prefix?: string;
};

/**
 * Creates a prompt/completion dataset for fine-tuning. With `bucket`, it is
 * written to S3/MinIO and the response carries the `s3://` ref the trainer can
 * pull (the intended path — a TL-local dataset gets mistaken for an HF id).
 * Without `bucket`, it falls back to the legacy TL-local store.
 */
export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const rows = (body.rows ?? [])
    .map((r) => ({ prompt: (r.prompt ?? "").trim(), completion: (r.completion ?? "").trim() }))
    .filter((r) => r.prompt && r.completion);
  if (!body.name?.trim() || rows.length === 0) {
    return Response.json(
      { error: "`name` and at least one non-empty {prompt, completion} row are required" },
      { status: 400 }
    );
  }
  try {
    if (body.bucket?.trim()) {
      const { id, ref } = await createDatasetOnS3(body.name, rows, body.bucket, body.prefix);
      return Response.json({ id, ref });
    }
    const id = await createDataset(body.name, rows);
    return Response.json({ id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not create dataset";
    return Response.json({ error: message }, { status: 502 });
  }
}
