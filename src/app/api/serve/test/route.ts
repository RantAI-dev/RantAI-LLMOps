import type { NextRequest } from "next/server";

import { INFERENCE_BASE_URL, inferenceHeaders } from "@/lib/inference";
import { fetchLoaded } from "@/lib/models-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fire one non-streaming chat completion at the currently-served model to prove
 * the API works end-to-end. Resolves the model from what TL has loaded (so we
 * never send a mismatched model id).
 */
export async function POST(req: NextRequest) {
  let body: { prompt?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const prompt = body.prompt?.trim() || "Say hello in one short sentence.";

  const model = await fetchLoaded();
  if (!model) {
    return Response.json({ error: "Tidak ada model yang sedang di-serve. Load satu dulu." }, { status: 409 });
  }

  try {
    const res = await fetch(`${INFERENCE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: inferenceHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        max_tokens: 128,
        temperature: 0.7,
      }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string } | string;
    };
    if (!res.ok) {
      const msg =
        typeof data.error === "string" ? data.error : data.error?.message || `HTTP ${res.status}`;
      return Response.json({ error: msg }, { status: 502 });
    }
    const reply = data.choices?.[0]?.message?.content ?? "";
    return Response.json({ model, reply });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Gagal memanggil model" },
      { status: 502 }
    );
  }
}
