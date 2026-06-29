import { listOllamaModels } from "@/lib/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lists the models Ollama is serving (its pulled models). Powers the "Select
 * model" dropdown. Returns an empty list (never errors) when Ollama is
 * unreachable, so the UI degrades gracefully.
 */
export async function GET() {
  const models = (await listOllamaModels()).map((m) => m.id);
  return Response.json({ models });
}
