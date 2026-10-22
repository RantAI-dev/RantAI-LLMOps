import type { NextRequest } from "next/server";

import {
  decisionConfigured,
  decisionServerState,
  deployableDecisionJobs,
  deployDecisionJob,
  DecisionServerError,
} from "@/lib/decision-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Loading an 8B decision model into the GPU takes a minute or more.
export const maxDuration = 300;

/** The decision server's state plus the finished decision jobs that could be deployed. */
export async function GET() {
  const server = await decisionServerState();
  if (!server.configured) return Response.json({ server, jobs: [] });
  let jobs: Awaited<ReturnType<typeof deployableDecisionJobs>> = [];
  try {
    jobs = await deployableDecisionJobs(server.models);
  } catch {
    // Transformer Lab unreachable: the served models are still worth showing.
  }
  return Response.json({ server, jobs });
}

/** Deploy a finished decision job: `{ jobId, name?, loadIn4bit? }`. */
export async function POST(req: NextRequest) {
  if (!decisionConfigured()) {
    return Response.json({ error: "The decision server is not configured" }, { status: 404 });
  }
  let body: { jobId?: unknown; name?: unknown; loadIn4bit?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body.jobId !== "string" || !body.jobId) {
    return Response.json({ error: "`jobId` is required" }, { status: 400 });
  }
  try {
    const model = await deployDecisionJob(body.jobId, {
      name: typeof body.name === "string" ? body.name : undefined,
      loadIn4bit: body.loadIn4bit === true,
    });
    return Response.json({ model }, { status: 201 });
  } catch (err) {
    const status = err instanceof DecisionServerError ? err.status : 502;
    return Response.json({ error: err instanceof Error ? err.message : "Deploy failed" }, { status });
  }
}
