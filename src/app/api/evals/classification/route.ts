import {
  DEFAULT_CLASSIFICATION_PROMPT,
  buildClassificationReport,
  deriveLabels,
  parseEvalJsonl,
  scoreClassCase,
  type ClassCase,
  type EvalExample,
} from "@/lib/classification-eval";
import {
  createClassEvalRun,
  listClassEvalRuns,
  pruneClassEvalRuns,
  saveClassEvalRun,
  type ClassEvalRun,
} from "@/lib/classification-eval-store";
import { logServerError } from "@/lib/log";
import { OLLAMA_V1 } from "@/lib/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Classification eval: replay a held-out test set (instruction = input, output =
 * true label) against a SERVED model and score it — Accuracy, Macro-F1, per-class
 * Precision/Recall, confusion matrix. Runs SERVER-SIDE; the response returns as
 * soon as the run is queued, and progress is written to the store so the page can
 * be closed and reopened. Evaluate the base model too for a before/after figure.
 */

const CONCURRENCY = 4;
const PROGRESS_EVERY = 5;

async function askModel(
  model: string,
  systemPrompt: string,
  instruction: string,
  maxTokens: number
): Promise<string> {
  const messages = systemPrompt
    ? [
        { role: "system", content: systemPrompt },
        { role: "user", content: instruction },
      ]
    : [{ role: "user", content: instruction }];
  const res = await fetch(`${OLLAMA_V1}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0 }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    throw new Error(`Model rejected the request (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

async function runEval(run: ClassEvalRun, examples: EvalExample[]): Promise<void> {
  const labels = run.labels;
  const cases: ClassCase[] = new Array(examples.length);
  let next = 0;
  let completed = 0;
  let errorCount = 0;
  let errorSample: string | undefined;

  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= examples.length) return;
      try {
        const reply = await askModel(run.model, run.systemPrompt, examples[i].instruction, run.maxTokens);
        cases[i] = scoreClassCase(examples[i], reply, labels);
      } catch (err) {
        cases[i] = scoreClassCase(examples[i], "", labels); // empty reply → UNKNOWN (a miss), keeps the run alive
        errorCount++;
        errorSample ??= err instanceof Error ? err.message : String(err);
      }
      completed++;
      if (completed % PROGRESS_EVERY === 0) {
        await saveClassEvalRun({ ...run, completed, errorCount, errorSample }).catch(() => {});
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, examples.length) }, worker));
    await saveClassEvalRun({
      ...run,
      status: "done",
      completed,
      errorCount,
      errorSample,
      report: buildClassificationReport(cases, labels),
      cases,
    });
  } catch (err) {
    logServerError("evals/classification run", err);
    await saveClassEvalRun({
      ...run,
      status: "error",
      completed,
      errorCount,
      errorSample,
      error: err instanceof Error ? err.message : "The eval failed to run",
    }).catch(() => {});
  }
  await pruneClassEvalRuns();
}

/** History, newest first (without per-row cases). */
export async function GET() {
  return Response.json({ runs: await listClassEvalRuns() });
}

export async function POST(req: Request) {
  let body: { model?: string; jsonl?: string; systemPrompt?: string; maxTokens?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body is not valid JSON" }, { status: 400 });
  }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) return Response.json({ error: "`model` is required" }, { status: 400 });
  if (typeof body.jsonl !== "string") {
    return Response.json({ error: "`jsonl` is required" }, { status: 400 });
  }

  let examples: EvalExample[];
  try {
    examples = parseEvalJsonl(body.jsonl);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "The eval set could not be read" },
      { status: 400 }
    );
  }

  const labels = deriveLabels(examples);
  if (labels.length < 2) {
    return Response.json(
      { error: "Need at least 2 distinct labels in the `output` column to score a classification." },
      { status: 400 }
    );
  }

  const systemPrompt =
    typeof body.systemPrompt === "string" ? body.systemPrompt : DEFAULT_CLASSIFICATION_PROMPT;
  // A label is one short token, so the cap is a runtime lever, not a quality one.
  const maxTokens = Number(body.maxTokens) > 0 ? Number(body.maxTokens) : 24;

  try {
    const run = await createClassEvalRun({
      model,
      systemPrompt,
      maxTokens,
      total: examples.length,
      labels,
    });
    // Detached on purpose: the work continues after the response.
    void runEval(run, examples).catch((err) => logServerError("evals/classification detached", err));
    return Response.json({ runId: run.id });
  } catch (err) {
    logServerError("evals/classification", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "The eval failed to start" },
      { status: 502 }
    );
  }
}
