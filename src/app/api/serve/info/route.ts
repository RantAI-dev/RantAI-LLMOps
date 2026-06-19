import {
  INFERENCE_API_KEY,
  INFERENCE_BASE_URL,
  INFERENCE_TEAM_ID,
} from "@/lib/inference";
import { fetchDownloaded, fetchLoaded } from "@/lib/models-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Connection details for using the currently-served model as an OpenAI-compatible
 * API. The served model = whatever Transformer Lab has loaded into VRAM (the same
 * engine the chat playground talks to). Returns the base URL, auth, the loaded
 * model id, and the list of downloadable models the user can serve instead.
 */
export async function GET() {
  try {
    const [loaded, downloaded] = await Promise.all([fetchLoaded(), fetchDownloaded()]);
    return Response.json({
      baseUrl: INFERENCE_BASE_URL,
      teamId: INFERENCE_TEAM_ID,
      apiKey: INFERENCE_API_KEY,
      loaded,
      models: downloaded.map((m) => ({ id: m.id, name: m.name, isGguf: m.isGguf })),
    });
  } catch {
    return Response.json({
      baseUrl: INFERENCE_BASE_URL,
      teamId: INFERENCE_TEAM_ID,
      apiKey: INFERENCE_API_KEY,
      loaded: null,
      models: [],
    });
  }
}
