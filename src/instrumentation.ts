/**
 * Next.js instrumentation — runs once when the server process starts.
 *
 * On boot we self-heal the LoRA adapters of vLLM and SGLang: any adapter the user
 * attached at runtime (recorded in that engine's manifest) is gone after an
 * engine restart, so we reconcile to re-load them without waiting for someone to
 * click "Sync now" on the Deployments page. Fire-and-forget and defensive — it
 * must never delay or fail server startup.
 */
export async function register() {
  // Only the Node.js server runtime talks to the engines (never the Edge runtime).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Demo mode has no real engine to reconcile.
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") return;

  const run = async (engine: "vllm" | "sglang") => {
    const { reconcileAdapters } = await import("@/lib/adapter-reconcile");
    // The engine may still be loading its model when the app boots, so retry with
    // a gap until a reconcile settles (no failures) or we give up.
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, i === 0 ? 8_000 : 12_000));
      try {
        const res = await reconcileAdapters(engine);
        if (!res.configured) return; // engine not configured on this deploy — nothing to do
        if (res.failed.length === 0) {
          if (res.loaded.length) {
            console.log(`[boot-reconcile] ${engine}: restored ${res.loaded.length} adapter(s): ${res.loaded.join(", ")}`);
          }
          return; // settled (loaded what was missing, or nothing to do)
        }
      } catch {
        /* engine unreachable yet — retry */
      }
    }
  };
  void run("vllm"); // never await — boot must not block on this
  void run("sglang");
}
