import { fetchEvalJobs } from "@/lib/evals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** All eval jobs with their benchmark scores (for the job list / live monitor). */
export async function GET() {
  return Response.json({ jobs: await fetchEvalJobs() });
}
