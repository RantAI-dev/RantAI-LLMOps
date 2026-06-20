import {
  INFERENCE_API_KEY,
  INFERENCE_BASE_URL,
  INFERENCE_TEAM_ID,
} from "@/lib/inference";
import { fetchDownloaded, fetchLoaded } from "@/lib/models-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Whether a real TL key is configured (not the Ollama "dummy" default). We never
// return the key itself — see below.
const hasKey = Boolean(INFERENCE_API_KEY) && INFERENCE_API_KEY !== "dummy";

/**
 * Connection details for using the currently-served model as an OpenAI-compatible
 * API. The served model = whatever Transformer Lab has loaded into VRAM (the same
 * engine the chat playground talks to).
 *
 * SECURITY: we deliberately do NOT return the raw `INFERENCE_API_KEY`. It is the
 * server's long-lived Transformer Lab credential; shipping it to the browser
 * would defeat the whole BFF boundary (anyone loading this page would hold the
 * backend master key). We only signal whether a key is configured; the UI tells
 * the user to copy their own key from `.env.local` / TL settings.
 */
export async function GET() {
  try {
    const [loaded, downloaded] = await Promise.all([fetchLoaded(), fetchDownloaded()]);
    return Response.json({
      baseUrl: INFERENCE_BASE_URL,
      teamId: INFERENCE_TEAM_ID,
      hasKey,
      loaded,
      models: downloaded.map((m) => ({ id: m.id, name: m.name, isGguf: m.isGguf })),
    });
  } catch (err) {
    console.error("[api/serve/info] Transformer Lab unreachable or rejected the request:", err);
    return Response.json({
      baseUrl: INFERENCE_BASE_URL,
      teamId: INFERENCE_TEAM_ID,
      hasKey,
      loaded: null,
      models: [],
    });
  }
}
