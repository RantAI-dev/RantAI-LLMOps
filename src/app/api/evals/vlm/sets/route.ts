import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import {
  createVlmEvalSetFromZip,
  listVlmEvalSets,
  vlmEvalLimits,
  VlmEvalSetError,
} from "@/lib/vlm-eval-set-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const denied = await guardApi(req);
  if (denied) return denied;
  return Response.json({ sets: await listVlmEvalSets() });
}

/** Multipart framing and the text fields on top of the ZIP's own bytes. */
const ENVELOPE_BYTES = 1024 * 1024;
/** next.config.ts buffers request bodies up to 110 MB and silently cuts the rest, so a ZIP is refused before that. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/**
 * Add a vision test set. Multipart: `file` (a ZIP: `train.jsonl` with the rows to score, `images/**`),
 * `name`, and `scoring` (exact | latex | numeric | anls | choice). The ZIP is validated like a vision
 * dataset's and every row of `train.jsonl` becomes a test row. Answers `{ set }`.
 */
export async function POST(req: NextRequest) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const lim = vlmEvalLimits();
  const cap = Math.min(lim.maxBytes, MAX_UPLOAD_BYTES);
  // Refuse an oversized upload before buffering it.
  if (Number(req.headers.get("content-length") ?? 0) > cap + ENVELOPE_BYTES) {
    return Response.json({ error: `The ZIP can be at most ${Math.round(cap / 1024 / 1024)} MB` }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Send the test set as multipart form data (file, name, scoring)" }, { status: 400 });
  }
  const name = String(form.get("name") ?? "").trim();
  const scoring = String(form.get("scoring") ?? "").trim();
  const file = form.get("file");
  if (!name) return Response.json({ error: "Test set name is required" }, { status: 400 });
  if (!(file instanceof File)) return Response.json({ error: "A ZIP file is required" }, { status: 400 });
  if (file.size > cap) return Response.json({ error: `The ZIP can be at most ${Math.round(cap / 1024 / 1024)} MB` }, { status: 413 });
  try {
    const set = await createVlmEvalSetFromZip({ name, scoring, zip: new Uint8Array(await file.arrayBuffer()), limits: lim });
    return Response.json({ set });
  } catch (err) {
    if (err instanceof VlmEvalSetError) return Response.json({ error: err.message }, { status: err.status });
    return Response.json({ error: err instanceof Error ? err.message : "Failed to add the test set" }, { status: 502 });
  }
}
