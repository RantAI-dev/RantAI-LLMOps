import type { NextRequest } from "next/server";

import { searchHfModels } from "@/lib/hf-hub";
import { logServerError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Search Hugging Face for GGUF models (Ollama-pullable). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  try {
    const models = await searchHfModels({
      search: sp.get("search") ?? undefined,
      task: sp.get("task") ?? undefined,
      sort: sp.get("sort") ?? undefined,
    });
    return Response.json({ models });
  } catch (err) {
    logServerError("hub/models", err);
    return Response.json({ error: "Could not reach Hugging Face", models: [] }, { status: 502 });
  }
}
