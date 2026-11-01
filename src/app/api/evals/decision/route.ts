import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { parseDecisionEvalSet } from "@/lib/decision-eval";
import { runDecisionEval } from "@/lib/decision-eval-runner";
import { listDecisionEvalSets, readDecisionEvalSet } from "@/lib/decision-eval-set-store";
import { createDecisionEvalRun, listDecisionEvalRuns } from "@/lib/decision-eval-store";
import { decisionConfigured, decisionPredict, decisionServerState } from "@/lib/decision-server";
import { logServerError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** History (newest first, without per-row cases) and the available test sets. */
export async function GET(req: NextRequest) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const [runs, sets] = await Promise.all([listDecisionEvalRuns(), listDecisionEvalSets()]);
  return Response.json({ runs, sets });
}

/**
 * Start a decision-model eval: `{ model, setId }`. Every row of the test set is sent to the SERVED
 * model and scored (accuracy, calibration, the automation curve; see decision-eval.ts). The response
 * returns as soon as the run is queued; progress is written to the run store, so the page can be
 * closed and reopened.
 */
export async function POST(req: NextRequest) {
  const denied = await guardApi(req);
  if (denied) return denied;
  let body: { model?: unknown; setId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body is not valid JSON" }, { status: 400 });
  }
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const setId = typeof body.setId === "string" ? body.setId.trim() : "";
  if (!model) return Response.json({ error: "`model` is required" }, { status: 400 });
  if (!setId) return Response.json({ error: "`setId` is required" }, { status: 400 });

  if (!decisionConfigured()) {
    return Response.json({ error: "The decision server is not configured" }, { status: 404 });
  }
  const server = await decisionServerState();
  if (!server.reachable) {
    return Response.json({ error: server.error ?? "The decision server is not reachable" }, { status: 502 });
  }
  const served = server.models.filter((m) => m.loaded).map((m) => m.name);
  if (!served.includes(model)) {
    return Response.json(
      { error: `"${model}" is not served right now. ${served.length ? `Served: ${served.join(", ")}.` : "Deploy a decision model first (Deployments)."}` },
      { status: 400 }
    );
  }

  let found;
  try {
    found = await readDecisionEvalSet(setId);
  } catch {
    return Response.json({ error: "Invalid test set id" }, { status: 400 });
  }
  if (!found) return Response.json({ error: "Test set not found" }, { status: 404 });
  const parsed = parseDecisionEvalSet(found.jsonl);
  if (parsed.rows.length === 0) {
    return Response.json({ error: "The test set has no usable rows" }, { status: 400 });
  }

  try {
    const run = await createDecisionEvalRun({
      model,
      setId,
      setName: found.meta.name,
      total: parsed.rows.length,
      meta: parsed.meta,
    });
    const predict = async (row: (typeof parsed.rows)[number]) => {
      const res = (await decisionPredict({ model, state: row.state, questions: row.questions })) as {
        answers?: Record<string, unknown>;
      };
      if (!res.answers) throw new Error("The decision server answered without `answers`");
      return res.answers;
    };
    // Detached on purpose: the work continues after the response.
    void runDecisionEval(run, parsed.rows, predict).catch((err) => logServerError("evals/decision detached", err));
    return Response.json({ runId: run.id });
  } catch (err) {
    logServerError("evals/decision", err);
    return Response.json({ error: err instanceof Error ? err.message : "The eval failed to start" }, { status: 502 });
  }
}
