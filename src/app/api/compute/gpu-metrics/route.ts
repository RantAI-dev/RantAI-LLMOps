import { getGpuStatus } from "@/lib/gpu-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Realtime GPU telemetry (nvidia-smi). Polled by the Compute page + training
 * monitor.
 *
 * Also carries `health`, because an empty list has two very different causes:
 * a machine with no GPU ("none"), and a container that has lost its device
 * access ("blocked"). The second one silently breaks every new GPU job while
 * everything already running keeps working, so it has to be visible.
 */
export async function GET() {
  const { gpus, health, detail } = await getGpuStatus();
  return Response.json({ gpus, health, ...(detail ? { detail } : {}) });
}
