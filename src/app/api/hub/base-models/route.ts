import { searchHfTrainableModels } from "@/lib/hf-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Trainable Hugging Face base models for the Fine-tune picker (full transformers
 * text-generation models, GGUF excluded). Query: `?q=<search>`.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const q = params.get("q") ?? "";
  const sort = params.get("sort") ?? "downloads";
  try {
    const models = await searchHfTrainableModels({ search: q, sort, limit: 20 });
    return Response.json({ models });
  } catch (err) {
    console.error("[api/hub/base-models] HF search failed:", err);
    return Response.json(
      { error: "Could not reach Hugging Face", models: [] },
      { status: 502 }
    );
  }
}
