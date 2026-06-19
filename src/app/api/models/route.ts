import { INFERENCE_BASE_URL, inferenceHeaders } from "@/lib/inference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lists the models the configured inference engine is serving (its OpenAI
 * `/v1/models`). Powers the "Select model" dropdown. Returns an empty list
 * (never errors) when the engine is unreachable, so the UI degrades gracefully.
 */
export async function GET() {
  try {
    const res = await fetch(`${INFERENCE_BASE_URL}/models`, {
      headers: inferenceHeaders(),
    });
    if (!res.ok) return Response.json({ models: [] });
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const models = Array.isArray(data?.data)
      ? data.data.map((m) => m.id).filter((id): id is string => typeof id === "string")
      : [];
    return Response.json({ models });
  } catch {
    return Response.json({ models: [] });
  }
}
