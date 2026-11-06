import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { SHA_RE, readChatImage } from "@/lib/chat-image-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A stored chat image by its sha256 (content-addressed, so the response never changes). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ sha: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { sha } = await params;
  if (!SHA_RE.test(sha)) return Response.json({ error: "Not found" }, { status: 404 });
  const img = await readChatImage(sha);
  if (!img) return Response.json({ error: "Not found" }, { status: 404 });
  return new Response(new Uint8Array(img.bytes), {
    headers: {
      "Content-Type": img.mime,
      "Content-Length": String(img.bytes.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      // Only ever displayed as an image; never let a browser sniff it into something else.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
