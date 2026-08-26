import { buildClassificationReport, rescoreClassCase } from "@/lib/classification-eval";
import {
  deleteClassEvalRun,
  readClassEvalRun,
  saveClassEvalRun,
} from "@/lib/classification-eval-store";
import { logServerError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One classification eval run, including its per-row cases. Polled while running. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const run = await readClassEvalRun(id);
    if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
    return Response.json({ run });
  } catch {
    return Response.json({ error: "Invalid run id" }, { status: 400 });
  }
}

/** Recompute a finished run's report from its stored replies — no model calls. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let run;
  try {
    run = await readClassEvalRun(id);
  } catch {
    return Response.json({ error: "Invalid run id" }, { status: 400 });
  }
  if (!run) return Response.json({ error: "Run not found" }, { status: 404 });
  if (!run.cases?.length) {
    return Response.json(
      { error: "This run did not store per-row answers, so it can't be rescored. Run the eval again." },
      { status: 400 }
    );
  }
  try {
    const cases = run.cases.map((c) => rescoreClassCase(c, run.labels));
    const updated = { ...run, cases, report: buildClassificationReport(cases, run.labels) };
    await saveClassEvalRun(updated);
    return Response.json({ run: updated });
  } catch (err) {
    logServerError("evals/classification recompute", err);
    return Response.json({ error: "Failed to recompute the score" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteClassEvalRun(id);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Invalid run id" }, { status: 400 });
  }
}
