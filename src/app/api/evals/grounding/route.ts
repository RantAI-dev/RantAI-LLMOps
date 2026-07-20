import {
  DEFAULT_GROUNDING_PROMPT,
  buildReport,
  parseEvalJsonl,
  scoreCase,
  type ScoredCase,
} from "@/lib/grounding-eval";
import { logServerError } from "@/lib/log";
import { OLLAMA_V1 } from "@/lib/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A few hundred prompts against a local model takes minutes, not seconds.
export const maxDuration = 600;

/**
 * Grounding eval: replay an eval set (the same instruction/output shape as the
 * SFT data) against a served model and score how it grounds.
 *
 * It evaluates the model as SERVED — the GGUF in Ollama, not the raw adapter —
 * so the numbers describe what users would actually get. That also makes the
 * base model evaluable, which is the point: without a prompt-only baseline there
 * is no way to tell whether a fine-tune earned its cost.
 */

/** Concurrent requests to the model. Enough to keep a run to a couple of minutes
 *  without swamping a box that may also be serving or training. */
const CONCURRENCY = 4;

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

export async function POST(req: Request) {
  let body: {
    model?: string;
    jsonl?: string;
    systemPrompt?: string;
    maxTokens?: number;
  };
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

  let examples;
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
  const maxTokens = Number(body.maxTokens) > 0 ? Number(body.maxTokens) : 512;

  try {
    const cases: ScoredCase[] = new Array(examples.length);
    let next = 0;
    const failures: string[] = [];

    // Fixed-size worker pool: each worker pulls the next index until exhausted.
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= examples.length) return;
        try {
          const reply = await askModel(model, systemPrompt, examples[i].instruction, maxTokens);
          cases[i] = scoreCase(examples[i], reply);
        } catch (err) {
          // Score the row as an empty reply so one flaky call cannot void the run,
          // but surface that it happened — a report built on silent errors lies.
          cases[i] = scoreCase(examples[i], "");
          failures.push(err instanceof Error ? err.message : String(err));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, examples.length) }, worker));

    return Response.json({
      model,
      report: buildReport(cases),
      cases,
      // Non-empty means some rows were scored on an empty reply — the numbers are
      // pessimistic and the run should be repeated.
      errors: failures.slice(0, 5),
      errorCount: failures.length,
    });
  } catch (err) {
    logServerError("evals/grounding", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Eval gagal dijalankan" },
      { status: 502 }
    );
  }
}
