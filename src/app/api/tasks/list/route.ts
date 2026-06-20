import { listAllJobs } from "@/lib/tasks-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * All Transformer Lab jobs (train / eval / export) in the working experiment,
 * normalized for the Tasks monitor. Degrades to an empty list when TL is down.
 */
export async function GET() {
  try {
    const jobs = await listAllJobs();
    return Response.json({ jobs });
  } catch (err) {
    console.error("[api/tasks/list] Transformer Lab unreachable or rejected the request:", err);
    return Response.json({ jobs: [] });
  }
}
