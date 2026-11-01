/**
 * Next.js instrumentation — runs once when the server process starts.
 *
 * Self-heals the LoRA adapters of vLLM and SGLang: an adapter the user attached
 * at runtime (recorded in that engine's manifest) is gone after an engine
 * restart. We reconcile on boot (retrying while the engines load) and then every
 * ADAPTER_RECONCILE_INTERVAL_S seconds (default 60, 0 = off), so an engine that
 * restarts on its own gets its adapters back within a minute — without waiting
 * for someone to click "Sync now" on the Deployments page. Until then, requests
 * for the missing adapter get a 404, never the base model. Fire-and-forget and
 * defensive — it must never delay or fail server startup.
 */
export async function register() {
  // Only the Node.js server runtime talks to the engines (never the Edge runtime).
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Demo mode has no real engine to reconcile.
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") return;

  const engines = ["vllm", "sglang"] as const;
  const busy = new Set<string>();

  /** One reconcile of one engine; true when it settled (nothing failed). Never throws. */
  const reconcileOnce = async (engine: (typeof engines)[number]): Promise<boolean> => {
    if (busy.has(engine)) return false;
    busy.add(engine);
    try {
      const { reconcileAdapters } = await import("@/lib/adapter-reconcile");
      const res = await reconcileAdapters(engine);
      if (res.loaded.length) {
        console.log(`[adapter-reconcile] ${engine}: restored ${res.loaded.length} adapter(s): ${res.loaded.join(", ")}`);
      }
      return !res.configured || res.failed.length === 0;
    } catch {
      return false; // engine unreachable (still loading or restarting) — try again later
    } finally {
      busy.delete(engine);
    }
  };

  const boot = async (engine: (typeof engines)[number]) => {
    // The engine may still be loading its model when the app boots, so retry with
    // a gap until a reconcile settles or we give up (the interval takes over).
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, i === 0 ? 8_000 : 12_000));
      if (await reconcileOnce(engine)) return;
    }
  };
  for (const e of engines) void boot(e); // never await — boot must not block on this

  const everyS = Number(process.env.ADAPTER_RECONCILE_INTERVAL_S ?? 60);
  if (Number.isFinite(everyS) && everyS > 0) {
    const timer = setInterval(() => {
      for (const e of engines) void reconcileOnce(e);
    }, everyS * 1000);
    timer.unref?.();
  }
}
