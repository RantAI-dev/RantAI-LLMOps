import { getInferenceStats } from "@/lib/inference-log-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Aggregated chat-inference usage for the Dashboard (real, from the request log). */
export async function GET() {
  const stats = await getInferenceStats();
  return Response.json(stats);
}
