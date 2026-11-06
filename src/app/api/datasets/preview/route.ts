import type { NextRequest } from "next/server";

import { previewTlDataset } from "@/lib/finetune";
import { previewVisionDataset } from "@/lib/vision-dataset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Real rows of a dataset on disk in Transformer Lab (`/data/preview`). Powers
 * the Dataset detail drawer's Preview tab. Degrades to empty (never 500s) so the
 * UI can fall back to its mock sample for datasets TL doesn't have.
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ error: "`id` is required" }, { status: 400 });
  const limitParam = Number(req.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 25;
  try {
    // An image dataset (train.jsonl + images/) is read here: TL's loader cannot take rows whose content is
    // sometimes a string and sometimes a list of parts. Rows come back with relative image paths
    // (`vision: true`); the detail view shows them through /api/datasets/vision/<id>/image.
    const vision = await previewVisionDataset(id, Math.min(limit, 25)).catch(() => null);
    if (vision) return Response.json(vision);
    // Image cells of other datasets (HF image columns) arrive as `data:image/...;base64,` strings and are kept as they are.
    const preview = await previewTlDataset(id, limit);
    return Response.json(preview);
  } catch {
    return Response.json({ columns: [], rows: [] });
  }
}
