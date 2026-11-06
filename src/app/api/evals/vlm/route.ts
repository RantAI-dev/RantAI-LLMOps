import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { engineRequestModel, engineUrlVar, listEngines, modelKnownTextOnly, resolveEngine } from "@/lib/inference-engines";
import { logServerError } from "@/lib/log";
import { getVlmEvalSet, listVlmEvalSets, readVlmEvalRows, VlmEvalSetError } from "@/lib/vlm-eval-set-store";
import { createVlmEvalRun, listVlmEvalRuns } from "@/lib/vlm-eval-store";
import { createEnginePredict, DEFAULT_VLM_MAX_TOKENS, MAX_VLM_MAX_TOKENS, runVlmEval } from "@/lib/vlm-eval-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** History (newest first, without per-row cases) and the available test sets. */
export async function GET(req: NextRequest) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const [runs, sets] = await Promise.all([listVlmEvalRuns(), listVlmEvalSets()]);
  return Response.json({ runs, sets });
}

const bare = (s: string) => s.replace(/:latest$/, "");

/**
 * Start a vision eval: `{ engine, model, setId, maxTokens? }`. Every row of the test set (an image and a
 * prompt) is sent to the SERVED model through its engine and the answer is scored against the row's key
 * (see vlm-eval.ts). Refused when the engine is not configured or reachable, when the model is not served,
 * or when the model is KNOWN to be text-only (Ollama says so; vLLM and SGLang do not, so those are let
 * through). The response returns as soon as the run is queued; progress is written to the run store, so
 * the page can be closed and reopened.
 */
export async function POST(req: NextRequest) {
  const denied = await guardApi(req);
  if (denied) return denied;
  let body: { engine?: unknown; model?: unknown; setId?: unknown; maxTokens?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body is not valid JSON" }, { status: 400 });
  }
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const setId = typeof body.setId === "string" ? body.setId.trim() : "";
  if (!model) return Response.json({ error: "`model` is required" }, { status: 400 });
  if (!setId) return Response.json({ error: "`setId` is required" }, { status: 400 });
  let maxTokens = DEFAULT_VLM_MAX_TOKENS;
  if (body.maxTokens !== undefined && body.maxTokens !== null) {
    const n = Number(body.maxTokens);
    if (!Number.isInteger(n) || n < 1 || n > MAX_VLM_MAX_TOKENS) {
      return Response.json({ error: `\`maxTokens\` must be a whole number from 1 to ${MAX_VLM_MAX_TOKENS}` }, { status: 400 });
    }
    maxTokens = n;
  }

  const engine = resolveEngine(typeof body.engine === "string" ? body.engine : undefined);
  if (!engine.configured) {
    return Response.json({ error: `${engine.label} is not configured on this server (set ${engineUrlVar(engine.id)})` }, { status: 404 });
  }

  try {
    const set = await getVlmEvalSet(setId);
    if (!set) return Response.json({ error: "Test set not found" }, { status: 404 });

    const info = (await listEngines()).find((e) => e.id === engine.id);
    if (!info || !info.available) {
      return Response.json({ error: `${engine.label} is not reachable right now` }, { status: 502 });
    }
    const served = info.models.find((m) => bare(m.id) === bare(model) || bare(m.name) === bare(model));
    if (!served) {
      const names = info.models.map((m) => m.id);
      return Response.json(
        { error: `"${model}" is not served by ${engine.label} right now. ${names.length ? `Served: ${names.join(", ")}.` : "Nothing is served."}` },
        { status: 400 }
      );
    }
    if (served.vision === false || (await modelKnownTextOnly(engine, model))) {
      return Response.json({ error: `"${model}" is a text-only model and cannot read images. Pick a vision model.` }, { status: 400 });
    }
    const wire = await engineRequestModel(engine, model);
    if (wire.error) return Response.json({ error: wire.error }, { status: 400 });

    const rows = await readVlmEvalRows(setId);
    if (!rows || rows.length === 0) return Response.json({ error: "The test set has no rows" }, { status: 400 });

    const run = await createVlmEvalRun({
      setId,
      setName: set.name,
      model,
      engine: engine.id,
      scoring: set.scoring,
      maxTokens,
      total: rows.length,
    });
    const predict = createEnginePredict({ engine, model: wire.model, setId, maxTokens });
    // Detached on purpose: the work continues after the response.
    void runVlmEval(run, rows, predict).catch((err) => logServerError("evals/vlm detached", err));
    return Response.json({ runId: run.id });
  } catch (err) {
    if (err instanceof VlmEvalSetError) return Response.json({ error: err.message }, { status: err.status });
    logServerError("evals/vlm", err);
    return Response.json({ error: err instanceof Error ? err.message : "The eval failed to start" }, { status: 502 });
  }
}
