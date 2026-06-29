import { OLLAMA_V1, listOllamaModels, loadedOllamaModel } from "@/lib/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Connection details for using the served model as an OpenAI-compatible API.
 *
 * v0.40.0: serving is handled by Ollama on the host (TL no longer serves
 * inference). Ollama's `/v1` is open locally — no API key needed — so `hasKey`
 * is false and `teamId` is empty. `models` are the pulled Ollama models (all
 * GGUF); `loaded` is whatever is currently hot in VRAM.
 */
export async function GET() {
  try {
    const [loaded, models] = await Promise.all([loadedOllamaModel(), listOllamaModels()]);
    return Response.json({
      baseUrl: OLLAMA_V1,
      teamId: "",
      hasKey: false,
      loaded,
      models: models.map((m) => ({ id: m.id, name: m.name, isGguf: true })),
    });
  } catch (err) {
    console.error("[api/serve/info] Ollama unreachable:", err);
    return Response.json({
      baseUrl: OLLAMA_V1,
      teamId: "",
      hasKey: false,
      loaded: null,
      models: [],
    });
  }
}
