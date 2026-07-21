import { DEFAULT_ENGINE, listEngines } from "@/lib/inference-engines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Connection details for using served models as an OpenAI-compatible API.
 *
 * v0.40.0: serving is delegated to an external engine — Ollama (default) or
 * vLLM. This returns every engine with its live availability under `engines`,
 * for the Serve UI to let the user pick one.
 *
 * The top-level `baseUrl` / `loaded` / `models` mirror the DEFAULT engine so the
 * existing consumers (the grounding model picker and the gateway page) keep
 * working unchanged — they predate the multi-engine shape.
 */
export async function GET() {
  const engines = await listEngines();
  const primary = engines.find((e) => e.id === DEFAULT_ENGINE) ?? engines[0];
  return Response.json({
    // Back-compat: the default engine, flattened.
    baseUrl: primary?.v1BaseUrl ?? "",
    teamId: "",
    hasKey: false,
    loaded: primary?.loaded ?? null,
    models: primary?.models ?? [],
    // New: all engines, for the multi-engine Serve UI.
    engines,
  });
}
