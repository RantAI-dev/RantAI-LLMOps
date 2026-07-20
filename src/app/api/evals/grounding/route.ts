import {
  createEvalRun,
  listEvalRuns,
  pruneEvalRuns,
  saveEvalRun,
  type EvalRun,
} from "@/lib/eval-run-store";
import {
  DEFAULT_GROUNDING_PROMPT,
  buildReport,
  parseEvalJsonl,
  scoreCase,
  type EvalExample,
  type ScoredCase,
} from "@/lib/grounding-eval";
import { logServerError } from "@/lib/log";
import { OLLAMA_V1 } from "@/lib/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Grounding eval: replay an eval set (the same instruction/output shape as the
 * SFT data) against a served model and score how it grounds.
 *
 * The run happens SERVER-SIDE and the response returns as soon as it is queued.
 * Scoring a few hundred prompts against an 8B model takes minutes, and doing
 * that inside the request meant leaving the page threw the work away. Progress
 * is written to the run store as it goes, so the UI can poll, close, come back.
 *
 * It evaluates the model as SERVED — the GGUF in Ollama, not the raw adapter —
 * so the numbers describe what a user would actually get, and the base model can
 * be evaluated too. That is the point: with a prompt-only baseline there is
 * finally a way to tell whether a fine-tune earned its cost.
 */

/** Concurrent requests to the model. Enough to help without swamping a box that
 *  may also be serving or training. */
const CONCURRENCY = 4;
/** Persist progress every N scored rows — often enough for a live progress bar,
 *  rarely enough not to rewrite the file on every single answer. */
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
    // Generous: the first call also pays for loading the model into memory.
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    throw new Error(`Model menolak permintaan (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

/** Score every example, writing progress as it goes. Runs detached from the
 *  request that started it. */
async function runEval(run: EvalRun, examples: EvalExample[]): Promise<void> {
  const cases: ScoredCase[] = new Array(examples.length);
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
        cases[i] = scoreCase(examples[i], reply);
      } catch (err) {
        // Score as an empty reply so one flaky call cannot void the run, but keep
        // a count: a report built on silent errors lies about the model.
        cases[i] = scoreCase(examples[i], "");
        errorCount++;
        errorSample ??= err instanceof Error ? err.message : String(err);
      }
      completed++;
      if (completed % PROGRESS_EVERY === 0) {
        await saveEvalRun({ ...run, completed, errorCount, errorSample }).catch(() => {});
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, examples.length) }, worker));
    await saveEvalRun({
      ...run,
      status: "done",
      completed,
      errorCount,
      errorSample,
      report: buildReport(cases),
      cases,
    });
  } catch (err) {
    logServerError("evals/grounding run", err);
    await saveEvalRun({
      ...run,
      status: "error",
      completed,
      errorCount,
      errorSample,
      error: err instanceof Error ? err.message : "Eval gagal dijalankan",
    }).catch(() => {});
  }
  await pruneEvalRuns();
}

/** History, newest first (without per-row cases — those load per run). */
export async function GET() {
  return Response.json({ runs: await listEvalRuns() });
}

export async function POST(req: Request) {
  let body: { model?: string; jsonl?: string; systemPrompt?: string; maxTokens?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body bukan JSON yang valid" }, { status: 400 });
  }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model) return Response.json({ error: "`model` wajib diisi" }, { status: 400 });
  if (typeof body.jsonl !== "string") {
    return Response.json({ error: "`jsonl` wajib diisi" }, { status: 400 });
  }

  let examples: EvalExample[];
  try {
    examples = parseEvalJsonl(body.jsonl);
  } catch (err) {
    // A malformed eval set must not be scored as if it were complete.
    return Response.json(
      { error: err instanceof Error ? err.message : "Eval set tidak bisa dibaca" },
      { status: 400 }
    );
  }

  const systemPrompt =
    typeof body.systemPrompt === "string" ? body.systemPrompt : DEFAULT_GROUNDING_PROMPT;
  // A grounded answer is a sentence plus its source, and a refusal is one line —
  // so the cap is a runtime lever, not a quality one. At 512 an 8B model that
  // rambles costs ~20s per question, turning the whole eval into a long wait.
  const maxTokens = Number(body.maxTokens) > 0 ? Number(body.maxTokens) : 192;

  try {
    const run = await createEvalRun({ model, systemPrompt, maxTokens, total: examples.length });
    // Deliberately NOT awaited: this server is a long-lived process, so the work
    // continues after the response and the client is free to navigate away.
    // `.catch` keeps a failure from surfacing as an unhandled rejection.
    void runEval(run, examples).catch((err) => logServerError("evals/grounding detached", err));
    return Response.json({ runId: run.id });
  } catch (err) {
    logServerError("evals/grounding", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Eval gagal dimulai" },
      { status: 502 }
    );
  }
}
