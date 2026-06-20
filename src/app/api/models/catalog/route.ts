import {
  fetchDownloaded,
  fetchFineTuned,
  fetchLoaded,
  recommendedWithStatus,
  type ModelCatalog,
} from "@/lib/models-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Powers the model picker. Returns what's downloaded, what's recommended for
 * this GPU, and which model is currently loaded — assembled from Transformer
 * Lab's own endpoints. Degrades to empty lists (never 500s) when TL is down, so
 * the picker can still render.
 */
export async function GET() {
  try {
    const [downloaded, loaded] = await Promise.all([fetchDownloaded(), fetchLoaded()]);
    const body: ModelCatalog = {
      loaded,
      downloaded,
      recommended: recommendedWithStatus(downloaded),
      fineTuned: fetchFineTuned(downloaded),
    };
    return Response.json(body);
  } catch (err) {
    console.error("[api/models/catalog] Transformer Lab unreachable or rejected the request:", err);
    return Response.json({
      loaded: null,
      downloaded: [],
      recommended: [],
      fineTuned: [],
    } satisfies ModelCatalog);
  }
}
