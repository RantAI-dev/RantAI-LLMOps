import type { NextRequest } from "next/server";

import { deployVllm, getVllmDeploymentStatus, type DeployVllmParams } from "@/lib/serve-vllm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Cloning the plugin + building the vLLM venv can take a little while.
export const maxDuration = 300;

/** GET — the current vLLM deployment (config + live job status + served URL). */
export async function GET() {
  const status = await getVllmDeploymentStatus();
  return Response.json(status);
}

/**
 * POST — launch a vLLM serving task (base model + optional LoRA adapters) through
 * TL's compute provider. Returns the persisted deployment.
 */
export async function POST(req: NextRequest) {
  let body: Partial<DeployVllmParams>;
  try {
    body = (await req.json()) as Partial<DeployVllmParams>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.baseModel) {
    return Response.json({ error: "`baseModel` is required" }, { status: 400 });
  }
  try {
    const deployment = await deployVllm(body as DeployVllmParams);
    return Response.json({ deployment });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to deploy vLLM";
    return Response.json({ error: message }, { status: 502 });
  }
}
