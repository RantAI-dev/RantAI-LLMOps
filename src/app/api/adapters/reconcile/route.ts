import { reconcileAdapters } from "@/lib/adapter-reconcile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — reconcile the running vLLM against the desired-state manifest: load
 * every remembered adapter that isn't currently live (e.g. after a vLLM
 * restart). Additive only — never unloads. Returns what it loaded / what failed.
 */
export async function POST() {
  try {
    const result = await reconcileAdapters();
    if (!result.configured) {
      return Response.json({ error: "vLLM isn't configured." }, { status: 400 });
    }
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reconcile failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
