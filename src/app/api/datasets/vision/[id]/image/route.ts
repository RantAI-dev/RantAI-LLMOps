import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { readVisionImage } from "@/lib/vision-dataset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One image of a stored vision dataset, for the thumbnails in the dataset detail. Workspace datasets only.
 * `path` must be `images/<...>.(png|jpg|jpeg|webp)` with no `..`; the response type comes from the image's
 * own bytes, never from its name, and anything that is not png / jpeg / webp is a 404.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { id } = await params;
  const path = req.nextUrl.searchParams.get("path") ?? "";
  let img: Awaited<ReturnType<typeof readVisionImage>> = null;
  try {
    img = await readVisionImage(id, path);
  } catch {
    img = null;
  }
  if (!img) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(new Uint8Array(img.bytes), {
    headers: {
      "Content-Type": img.mime,
      "Content-Length": String(img.bytes.byteLength),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  });
}
