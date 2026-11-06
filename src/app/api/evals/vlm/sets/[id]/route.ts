import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { deleteVlmEvalSet, getVlmEvalSet, readVlmEvalRows, VlmEvalSetError } from "@/lib/vlm-eval-set-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** How many rows come back as a preview (the page shows them as thumbnails). */
const PREVIEW_ROWS = 8;

/** One test set and its first rows. Images are served by `.../image?path=`. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    const set = await getVlmEvalSet(id);
    if (!set) return Response.json({ error: "Test set not found" }, { status: 404 });
    const rows = (await readVlmEvalRows(id)) ?? [];
    return Response.json({ set, preview: rows.slice(0, PREVIEW_ROWS) });
  } catch (err) {
    if (err instanceof VlmEvalSetError) return Response.json({ error: err.message }, { status: err.status });
    return Response.json({ error: "Could not read the test set" }, { status: 502 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    await deleteVlmEvalSet(id);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof VlmEvalSetError) return Response.json({ error: err.message }, { status: err.status });
    return Response.json({ error: "Could not delete the test set" }, { status: 502 });
  }
}
