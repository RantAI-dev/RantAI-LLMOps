import type { NextRequest } from "next/server";

import { previewTlDataset } from "@/lib/finetune";

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
    const preview = await previewTlDataset(id, limit);
    return Response.json(preview);
  } catch {
    return Response.json({ columns: [], rows: [] });
  }
}
