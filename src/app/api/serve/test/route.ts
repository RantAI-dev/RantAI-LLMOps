import type { NextRequest } from "next/server";

import { completeOnLoadedModel } from "@/lib/generate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Fire one non-streaming chat completion at the currently-served model to prove
 * the API works end-to-end.
 */
export async function POST(req: NextRequest) {
  let body: { prompt?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const prompt = body.prompt?.trim() || "Say hello in one short sentence.";

  try {
    const result = await completeOnLoadedModel(prompt, { temperature: 0.7, maxTokens: 128 });
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Gagal memanggil model";
    // "No model loaded" is a 409 (user action needed), anything else a 502.
    const status = message.includes("dimuat") ? 409 : 502;
    return Response.json({ error: message }, { status });
  }
}
