import {
  fetchDownloaded,
  fetchLoaded,
  fetchServable,
  ollamaRecommendedWithStatus,
  recommendedWithStatus,
  type ModelCatalog,
} from "@/lib/models-catalog";
import { fetchFineTuned } from "@/lib/finetune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Powers the model picker. Two namespaces:
 *  - `downloaded`/`recommended`/`fineTuned` = Transformer Lab's model registry
 *    (HF ids) for training/eval context.
 *  - `servable`/`ollamaRecommended` = Ollama models for chat/serving.
 *  - `loaded` = whatever Ollama currently holds in VRAM.
 * Degrades to empty lists (never 500s) when a backend is down.
 */
export async function GET() {
  const [downloaded, loaded, servable, fineTuned] = await Promise.all([
    fetchDownloaded().catch(() => []),
    fetchLoaded().catch(() => null),
    fetchServable().catch(() => []),
    fetchFineTuned().catch(() => []),
  ]);
  const body: ModelCatalog = {
    loaded,
    downloaded,
    recommended: recommendedWithStatus(downloaded),
    fineTuned,
    servable,
    ollamaRecommended: ollamaRecommendedWithStatus(servable),
  };
  return Response.json(body);
}
