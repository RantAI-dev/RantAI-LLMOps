import {
  clearWorkflowRuns,
  listWorkflowRuns,
  saveWorkflowRun,
  type WorkflowRun,
} from "@/lib/workflow-run-store";
import { logServerError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Workflow run history, persisted server-side (team-visible, survives a browser
 * cache clear). GET lists newest-first, POST saves one run, DELETE clears all.
 */
export async function GET() {
  try {
    return Response.json({ runs: await listWorkflowRuns() });
  } catch (err) {
    logServerError("workflows/runs GET", err);
    return Response.json({ runs: [] });
  }
}

export async function POST(req: Request) {
  try {
    const run = (await req.json()) as WorkflowRun;
    await saveWorkflowRun(run);
    return Response.json({ runs: await listWorkflowRuns() });
  } catch (err) {
    logServerError("workflows/runs POST", err);
    return Response.json(
      { error: "Failed to save run", runs: await listWorkflowRuns().catch(() => []) },
      { status: 400 }
    );
  }
}

export async function DELETE() {
  try {
    await clearWorkflowRuns();
    return Response.json({ ok: true });
  } catch (err) {
    logServerError("workflows/runs DELETE", err);
    return Response.json({ error: "Failed to clear history" }, { status: 500 });
  }
}
