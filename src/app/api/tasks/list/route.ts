import { listAllJobs } from "@/lib/tasks-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * All backend jobs (train / eval / export) in the working experiment,
 * normalized for the Tasks monitor.
 *
 * A backend that cannot be reached answers 502, NOT an empty list. An empty
 * list is indistinguishable from "you have no jobs", and that exact confusion
 * cost hours on 21 July: auth dropped, every list came back empty, and it read
 * as permanent data loss when the files had never moved.
 */
export async function GET() {
  try {
    const jobs = await listAllJobs();
    return Response.json({ jobs });
  } catch (err) {
    console.error("[api/tasks/list] backend unreachable or rejected the request:", err);
    return Response.json(
      { error: "The backend is unreachable, so the job list could not be loaded." },
      { status: 502 }
    );
  }
}
