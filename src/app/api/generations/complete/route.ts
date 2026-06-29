import type { NextRequest } from "next/server";

import { completeOnLoadedModel } from "@/lib/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A small-model completion on a modest GPU can take a few seconds.
export const maxDuration = 120;

/**
 * One non-streaming completion against the currently-loaded model. Used by the
 * output-comparison flow, which loads base / fine-tuned models in turn and asks
 * each the same prompts.
 */
export async function POST(req: NextRequest) {
  let body: { prompt?: string; temperature?: number; maxTokens?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const prompt = body.prompt?.trim();
  if (!prompt) return Response.json({ error: "`prompt` is required" }, { status: 400 });

  try {
    const result = await completeOnLoadedModel(prompt, {
      temperature: body.temperature,
      maxTokens: body.maxTokens,
    });
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Gagal memanggil model" },
      { status: 502 }
    );
  }
}
