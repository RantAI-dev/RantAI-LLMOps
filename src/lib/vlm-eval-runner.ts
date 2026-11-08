/**
 * Runs a VLM eval: every row of a test set (an image and a prompt) is sent to the SERVED model, the answers
 * are scored against the keys, and progress is written to the run store after each row. The caller starts it
 * detached (the HTTP response returns as soon as the run is queued), so the page can be closed and reopened.
 *
 * The model answers through the same engine `/v1/chat/completions` that chat and the gateway use, so the eval
 * measures the model people actually call. That engine is SHARED with production, hence the small worker pool.
 */
import { logServerError } from "@/lib/log";
import type { ResolvedEngine } from "@/lib/inference-engines";
import {
  pruneVlmEvalRuns,
  saveVlmEvalRun,
  type VlmEvalRun,
} from "@/lib/vlm-eval-store";
import { buildVlmReport, scoreVlm, type VlmCase } from "@/lib/vlm-eval";
import { readVlmEvalImage, type VlmEvalRow } from "@/lib/vlm-eval-set-store";

/** Requests in flight at once. The engine is shared with production, so two keep it busy without crowding users out. */
export const VLM_CONCURRENCY = 2;
export const DEFAULT_VLM_MAX_TOKENS = 256;
export const MAX_VLM_MAX_TOKENS = 4096;
/** Stored answers are cut here: the case table needs the start of an answer, not a runaway one. */
const STORED_TEXT_CHARS = 2000;
const STORED_PROMPT_CHARS = 1000;
const REQUEST_TIMEOUT_MS = 180_000;

export type VlmAnswer = {
  text: string;
  /** Completion tokens, when the engine reports them. */
  tokens?: number;
  /** finish_reason was "length": the answer was cut by `max_tokens`. */
  truncated?: boolean;
};

export type VlmPredict = (row: VlmEvalRow) => Promise<VlmAnswer>;

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

export async function runVlmEval(run: VlmEvalRun, rows: VlmEvalRow[], predict: VlmPredict): Promise<void> {
  const cases: VlmCase[] = new Array(rows.length);
  let next = 0;
  let completed = 0;
  let errors = 0;
  let correct = 0;
  let errorSample: string | undefined;
  const progress = () => ({ completed, total: rows.length, errors, correct });
  // Two workers finish rows at overlapping times. Saves go through one chain, and the progress snapshot is taken
  // when a save actually runs, so a slower write can never put an older count on disk after a newer one.
  let saving: Promise<unknown> = Promise.resolve();
  const saveProgress = () => {
    saving = saving.then(() => saveVlmEvalRun({ ...run, progress: progress(), errorSample }).catch(() => {}));
    return saving;
  };

  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= rows.length) return;
      const row = rows[i]!;
      const base = {
        id: row.id,
        ...(row.images[0] ? { image: row.images[0] } : {}),
        prompt: clip(row.prompt, STORED_PROMPT_CHARS),
        gold: clip(row.gold, STORED_TEXT_CHARS),
        ...(row.category ? { category: row.category } : {}),
      };
      const t0 = Date.now();
      try {
        const answer = await predict(row);
        const text = answer.text ?? "";
        const s = scoreVlm(run.scoring, text, row.gold);
        cases[i] = {
          ...base,
          pred: clip(text, STORED_TEXT_CHARS),
          correct: s.correct,
          score: s.score,
          ...(s.cer !== undefined ? { cer: s.cer } : {}),
          ...(answer.tokens !== undefined ? { tokens: answer.tokens } : {}),
          ...(answer.truncated ? { truncated: true } : {}),
          latencyMs: Date.now() - t0,
        };
        if (s.correct) correct++;
      } catch (err) {
        // A failed request is not a wrong answer: the row is left out of the metrics and counted, so the
        // report says how many rows it really covers instead of quietly scoring them as misses.
        const message = err instanceof Error ? err.message : String(err);
        cases[i] = { ...base, pred: "", correct: false, score: 0, error: clip(message, 500), latencyMs: Date.now() - t0 };
        errors++;
        errorSample ??= clip(message, 500);
      }
      completed++;
      await saveProgress();
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(VLM_CONCURRENCY, rows.length) }, worker));
    const report = buildVlmReport(cases, run.scoring);
    if (report.scored === 0) {
      // Nothing was scored: every request failed.
      await saveVlmEvalRun({
        ...run,
        status: "error",
        finishedAt: Date.now(),
        progress: progress(),
        errorSample,
        error: errorSample ? `No row could be scored: ${errorSample}` : "No row could be scored",
      });
    } else {
      await saveVlmEvalRun({ ...run, status: "done", finishedAt: Date.now(), progress: progress(), errorSample, report, cases });
    }
  } catch (err) {
    logServerError("vlm eval run", err);
    await saveVlmEvalRun({
      ...run,
      status: "error",
      finishedAt: Date.now(),
      progress: progress(),
      errorSample,
      error: err instanceof Error ? err.message : "The eval failed to run",
    }).catch(() => {});
  }
  await pruneVlmEvalRuns();
}

// -------------------------------------------------------------------------------------------------
// The request to the engine
// -------------------------------------------------------------------------------------------------

type ChatMessage = { role: "system" | "user"; content: string | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> };

/** The body of one `/chat/completions` request: the row's image(s) as data URLs, then its prompt. Temperature 0. */
export function buildVlmChatBody(input: { model: string; row: VlmEvalRow; imageUrls: string[]; maxTokens: number }) {
  const messages: ChatMessage[] = [];
  if (input.row.system) messages.push({ role: "system", content: input.row.system });
  messages.push({
    role: "user",
    content: [
      ...input.imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
      { type: "text" as const, text: input.row.prompt },
    ],
  });
  return { model: input.model, messages, temperature: 0, max_tokens: input.maxTokens, stream: false };
}

type ChatReply = {
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: string | null }>;
  usage?: { completion_tokens?: number };
};

/** The answer text of a reply. Some engines send content as parts; a reasoning model may lead with a <think> block, which is not the answer. */
export function replyText(content: unknown): string {
  let text = "";
  if (typeof content === "string") text = content;
  else if (Array.isArray(content)) {
    text = content.map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("");
  }
  return text.replace(/^\s*<think>[\s\S]*?<\/think>/, "").trim();
}

/**
 * `predict` for a real engine. `model` is the name to put on the wire (already mapped for SGLang); the
 * images are read from the set's folder and sent inline as data URLs, as the Playground does.
 */
export function createEnginePredict(opts: {
  engine: ResolvedEngine;
  model: string;
  setId: string;
  maxTokens: number;
  timeoutMs?: number;
}): VlmPredict {
  return async (row) => {
    const imageUrls: string[] = [];
    for (const rel of row.images) {
      const img = await readVlmEvalImage(opts.setId, rel);
      if (!img) throw new Error(`Image ${rel} is missing from the test set`);
      imageUrls.push(`data:${img.mime};base64,${Buffer.from(img.bytes).toString("base64")}`);
    }
    const res = await fetch(`${opts.engine.v1BaseUrl}/chat/completions`, {
      method: "POST",
      headers: opts.engine.headers,
      body: JSON.stringify(buildVlmChatBody({ model: opts.model, row, imageUrls, maxTokens: opts.maxTokens })),
      signal: AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
      throw new Error(`${opts.engine.label} answered ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    const data = (await res.json()) as ChatReply;
    const choice = data.choices?.[0];
    if (!choice) throw new Error(`${opts.engine.label} answered without a choice`);
    return {
      text: replyText(choice.message?.content),
      ...(typeof data.usage?.completion_tokens === "number" ? { tokens: data.usage.completion_tokens } : {}),
      ...(choice.finish_reason === "length" ? { truncated: true } : {}),
    };
  };
}
