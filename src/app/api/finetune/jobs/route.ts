import { fetchTrainingJobs } from "@/lib/finetune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** All fine-tune jobs (for the job list / live monitor). */
export async function GET() {
  return Response.json({ jobs: await fetchTrainingJobs() });
}
