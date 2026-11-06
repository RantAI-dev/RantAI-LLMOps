import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { VISION_BATCH_ENVELOPE_BYTES, VISION_BATCH_MAX_BYTES } from "@/lib/vision-limits";
import { destinationFrom, uploadVisionImages, visionErrorResponse, type VisionImage } from "@/lib/vision-dataset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tooLarge = () =>
  Response.json({ error: `One request carries at most ${VISION_BATCH_MAX_BYTES / 1024 / 1024} MB of images` }, { status: 413 });

/**
 * Step 2: a batch of images (at most 20 MB per request). Multipart form with repeated pairs, in this order:
 * `relpath` (e.g. `images/a.png`, always under `images/`, no `..`) then `file` (the bytes). Each file is checked
 * for its path, size and real type (png / jpeg / webp by content, matching its extension) before any is stored.
 * Query: `destination`, `bucket`, `prefix` as given to `init`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { id } = await params;
  if (Number(req.headers.get("content-length") ?? 0) > VISION_BATCH_MAX_BYTES + VISION_BATCH_ENVELOPE_BYTES) return tooLarge();

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Body must be multipart/form-data" }, { status: 400 });
  }
  const relpaths = form.getAll("relpath");
  const files = form.getAll("file");
  if (relpaths.length === 0 || relpaths.length !== files.length) {
    return Response.json({ error: "Send one `relpath` for every `file`" }, { status: 400 });
  }
  let total = 0;
  const images: VisionImage[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const rel = relpaths[i];
    if (!(f instanceof File) || typeof rel !== "string") return Response.json({ error: "Each `relpath` must be text and each `file` a file" }, { status: 400 });
    total += f.size;
    if (total > VISION_BATCH_MAX_BYTES) return tooLarge();
    images.push({ relpath: rel, bytes: new Uint8Array(await f.arrayBuffer()) });
  }
  try {
    const dest = destinationFrom((k) => req.nextUrl.searchParams.get(k));
    return Response.json(await uploadVisionImages({ id, destination: dest, images }));
  } catch (err) {
    return visionErrorResponse(err);
  }
}
