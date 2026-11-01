import { stopSglangDeployment } from "@/lib/serve-sglang-container";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST — stop the managed SGLang container and clear the deployment. */
export async function POST() {
  const ok = await stopSglangDeployment();
  return Response.json({ ok });
}
