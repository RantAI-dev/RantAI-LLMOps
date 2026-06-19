import type { NextRequest } from "next/server";

import { downloadModel } from "@/lib/models-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A model download can take a while (GGUF files are ~1–3 GB).
export const maxDuration = 600;

/**
 * Downloads a model into Transformer Lab. Called from the picker's Recommended
 * / Hub list. Blocks until the download finishes (TL pulls the bytes), then the
 * client refreshes the catalog so the model appears under Downloaded.
 */
export async function POST(req: NextRequest) {
  let body: { repo?: string; ggufFile?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.repo) {
    return Response.json({ error: "`repo` is required" }, { status: 400 });
  }
  try {
    await downloadModel(body.repo, body.ggufFile);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Download failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
