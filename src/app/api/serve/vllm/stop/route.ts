import { stopVllmDeployment } from "@/lib/serve-vllm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — stop the running vLLM serve task and clear the deployment. */
export async function POST() {
  const ok = await stopVllmDeployment();
  return Response.json({ ok });
}
