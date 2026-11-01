import { reconcileAdapters } from "@/lib/adapter-reconcile";
import { ENGINE_LABEL, isLoraEngine } from "@/lib/engine-lora";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST ?engine=vllm|sglang (default vllm) — reconcile the running engine against
 * its desired-state manifest: load every remembered adapter that isn't currently
 * live (e.g. after an engine restart). Additive only — never unloads. Returns
 * what it loaded / what failed.
 */
export async function POST(req: Request) {
  const raw = new URL(req.url).searchParams.get("engine") ?? "vllm";
  if (!isLoraEngine(raw)) return Response.json({ error: 'engine must be "vllm" or "sglang".' }, { status: 400 });
  try {
    const result = await reconcileAdapters(raw);
    if (!result.configured) {
      return Response.json({ error: `${ENGINE_LABEL[raw]} isn't configured.` }, { status: 400 });
    }
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reconcile failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
