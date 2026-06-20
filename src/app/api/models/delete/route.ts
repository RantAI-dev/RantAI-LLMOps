import type { NextRequest } from "next/server";

import { deleteModels } from "@/lib/models-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Delete one or more local models (e.g. a fine-tuned model + its GGUF export). */
export async function POST(req: NextRequest) {
  let body: { modelIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const ids = (body.modelIds ?? []).filter((id) => typeof id === "string" && id);
  if (ids.length === 0) {
    return Response.json({ error: "`modelIds` is required" }, { status: 400 });
  }
  const { deleted, failed } = await deleteModels(ids);
  if (failed.length > 0) {
    return Response.json(
      { ok: false, deleted, failed, error: `Gagal hapus: ${failed.join(", ")}` },
      { status: 502 }
    );
  }
  return Response.json({ ok: true, deleted });
}
