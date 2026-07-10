import { getGpuMetrics } from "@/lib/gpu-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Realtime GPU telemetry (nvidia-smi). Polled by the Compute page + training
 *  monitor. Returns `{ gpus: [] }` when no NVIDIA GPU / nvidia-smi is present. */
export async function GET() {
  const gpus = await getGpuMetrics();
  return Response.json({ gpus });
}
