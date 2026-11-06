import type { NextRequest } from "next/server";

import { chatLimits, parseImageDataUrl } from "@/lib/chat-content";
import { ChatImageError, saveChatImage } from "@/lib/chat-image-store";
import { guardApi } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Store one chat image and answer `{ ref, sha, mime, bytes }`; the Playground keeps only `ref`
 * (`/api/chat-images/<sha>`) in the conversation. Two body shapes:
 *
 *  - JSON `{ "dataUrl": "data:image/jpeg;base64,..." }`
 *  - multipart/form-data with an image in the `file` field
 *
 * MIME and size are checked here and again against the real bytes.
 */
export async function POST(req: NextRequest) {
  const denied = await guardApi(req);
  if (denied) return denied;

  // A data URL is 4/3 of the image, plus the multipart/JSON envelope.
  const maxBody = Math.ceil((chatLimits().maxImageBytes * 4) / 3) + 1024 * 1024;
  if (Number(req.headers.get("content-length") ?? 0) > maxBody) {
    return Response.json({ error: "Image is too large" }, { status: 413 });
  }

  try {
    const type = req.headers.get("content-type") ?? "";
    let bytes: Uint8Array;
    let mime: string | undefined;
    if (type.startsWith("multipart/form-data")) {
      const file = (await req.formData()).get("file");
      if (!(file instanceof File)) {
        return Response.json({ error: "multipart field `file` is required" }, { status: 400 });
      }
      if (file.size > chatLimits().maxImageBytes) throw new ChatImageError("Image is too large", 413);
      bytes = new Uint8Array(await file.arrayBuffer());
      mime = file.type || undefined;
    } else {
      let body: { dataUrl?: unknown };
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "Invalid JSON body" }, { status: 400 });
      }
      const url = typeof body?.dataUrl === "string" ? body.dataUrl : "";
      const parsed = parseImageDataUrl(url);
      if (!parsed) {
        return Response.json({ error: "`dataUrl` must be a base64 png, jpeg, webp or gif data URL" }, { status: 400 });
      }
      bytes = Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
      mime = parsed.mime;
    }
    const saved = await saveChatImage(bytes, mime);
    return Response.json({ ref: saved.ref, sha: saved.sha, mime: saved.mime, bytes: saved.bytes });
  } catch (err) {
    if (err instanceof ChatImageError) return Response.json({ error: err.message }, { status: err.status });
    console.error("[chat-images] upload failed:", err);
    return Response.json({ error: "Could not store the image" }, { status: 500 });
  }
}
