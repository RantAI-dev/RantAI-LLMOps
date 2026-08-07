import type { NextRequest } from "next/server";

import { csvToJsonl, previewTlDataset } from "@/lib/finetune";
import { getDatasetObjectText, listDatasetObjects } from "@/lib/s3";
import { parseS3Ref } from "@/lib/s3-datasets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Preview = { columns: string[]; rows: Array<Record<string, string>> };

/** Parse up to `limit` rows of JSONL text into the column/row preview shape. */
function jsonlPreview(text: string, limit: number): Preview {
  const columns: string[] = [];
  const seen = new Set<string>();
  const rows: Array<Record<string, string>> = [];
  for (const line of text.split("\n")) {
    if (rows.length >= limit) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!seen.has(k)) {
        seen.add(k);
        columns.push(k);
      }
      row[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    rows.push(row);
  }
  return { columns, rows };
}

/**
 * Real rows of a dataset for the detail drawer's Preview tab. Two sources:
 *  - an `s3://bucket/key` id → read the object from S3/MinIO and parse it.
 *  - anything else → a dataset on disk in Transformer Lab (`/data/preview`).
 * Degrades to empty (never 500s) so the UI can fall back to its sample.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "`id` is required" }, { status: 400 });
  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 25;

  try {
    if (id.startsWith("s3://")) {
      const { bucket, key } = parseS3Ref(id);
      let readKey = key;
      if (key === "" || key.endsWith("/")) {
        // A whole prefix/bucket import — preview the first file under it (prefer
        // a .jsonl shard) so the drawer shows representative rows.
        const objects = await listDatasetObjects(bucket, key);
        if (objects.length === 0) return Response.json({ columns: [], rows: [] });
        readKey = (objects.find((o) => o.format === "jsonl") ?? objects[0]).key;
      }
      const text = await getDatasetObjectText(bucket, readKey);
      const jsonl = /\.csv$/i.test(readKey) ? csvToJsonl(text) : text;
      return Response.json(jsonlPreview(jsonl, limit));
    }
    const preview = await previewTlDataset(id, limit);
    return Response.json(preview);
  } catch {
    return Response.json({ columns: [], rows: [] });
  }
}
