import type { NextRequest } from "next/server";

import type { DeployVllmParams } from "@/lib/serve-vllm";
import { deploySglang, getSglangDeploymentStatus } from "@/lib/serve-sglang-container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Pulling the SGLang image can take a while on a fresh host.
export const maxDuration = 300;

/** GET — the current SGLang deployment (config + container status + served URL). */
export async function GET() {
  return Response.json(await getSglangDeploymentStatus());
}

/** POST — launch a managed SGLang container (base model + optional LoRA adapters). */
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
    const deployment = await deploySglang(body as DeployVllmParams);
    return Response.json({ deployment });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to deploy SGLang";
    return Response.json({ error: message }, { status: 502 });
  }
}
