/**
 * Next.js instrumentation — runs once when the server process starts.
 *
 * On boot we self-heal the vLLM LoRA adapters (Phase 2): any adapter the user
 * attached at runtime (recorded in the manifest) is gone from vLLM after a
 * restart, so we reconcile to re-load them without waiting for someone to click
 * "Sync now" on the Deployments page. Fire-and-forget and defensive — it must
 * never delay or fail server startup.
 */
export async function register() {
  // Only the Node.js server runtime talks to vLLM (never the Edge runtime).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Demo mode has no real vLLM to reconcile.
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") return;

  const run = async () => {
    const { reconcileAdapters } = await import("@/lib/adapter-reconcile");
    // vLLM may still be loading its model when the app boots, so retry with a
    // gap until a reconcile settles (no failures) or we give up.
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, i === 0 ? 8_000 : 12_000));
      try {
        const res = await reconcileAdapters();
        if (!res.configured) return; // vLLM not configured on this deploy — nothing to do
        if (res.failed.length === 0) {
          if (res.loaded.length) {
            console.log(`[boot-reconcile] restored ${res.loaded.length} adapter(s): ${res.loaded.join(", ")}`);
          }
          return; // settled (loaded what was missing, or nothing to do)
        }
      } catch {
        /* vLLM unreachable yet — retry */
      }
    }
  };
  void run(); // never await — boot must not block on this
}
