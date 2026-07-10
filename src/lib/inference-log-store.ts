/**
 * Append-only log of chat inference requests + aggregate stats for the Dashboard.
 * Every reply the chat BFF finishes (and every failed request) is appended as one
 * JSON line to `$RANTAI_DATA_DIR/inference-log.jsonl`; the Dashboard reads back
 * real usage analytics (request count, latency, tok/s, tokens, error rate) —
 * replacing the previously-absent/zeroed usage numbers with honest data.
 *
 * JSONL + append means logging never does a read-modify-write. Stats aggregate
 * over the most recent MAX_READ events (the file grows unbounded otherwise — fine
 * for local self-host; a rotation could be added later).
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.RANTAI_DATA_DIR ?? path.join(process.cwd(), ".rantai-data");
const FILE = path.join(DATA_DIR, "inference-log.jsonl");
const MAX_READ = 5000;

export type InferenceEvent = {
  ts: number;
  model: string;
  status: "ok" | "error";
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  tokS: number;
  ttftMs: number;
  totalMs: number;
  finishReason: string;
};

/** Append one inference event (fire-and-forget — never blocks/faults the chat). */
export async function logInference(ev: InferenceEvent): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.appendFile(FILE, `${JSON.stringify(ev)}\n`, "utf8");
  } catch (err) {
    console.error("[inference-log] append failed:", err);
  }
}

async function readEvents(): Promise<InferenceEvent[]> {
  let raw: string;
  try {
    raw = await fs.readFile(FILE, "utf8");
  } catch {
    return [];
  }
  const out: InferenceEvent[] = [];
  for (const line of raw.split("\n").filter(Boolean).slice(-MAX_READ)) {
    try {
      const e = JSON.parse(line) as InferenceEvent;
      if (e && typeof e === "object" && typeof e.ts === "number") out.push(e);
    } catch {
      /* skip a corrupt line rather than fail the whole read */
    }
  }
  return out;
}

export type InferenceStats = {
  total: number;
  errors: number;
  errorRate: number;
  last24h: number;
  totalTokens: number;
  avgTtftMs: number;
  avgTotalMs: number;
  avgTokS: number;
  byModel: Array<{ model: string; count: number }>;
};

function avg(nums: number[]): number {
  return nums.length ? Math.round(nums.reduce((s, n) => s + n, 0) / nums.length) : 0;
}

export async function getInferenceStats(): Promise<InferenceStats> {
  const events = await readEvents();
  const ok = events.filter((e) => e.status === "ok");
  const errors = events.length - ok.length;
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

  const tokS = ok.map((e) => e.tokS || 0).filter((n) => n > 0);
  const byModel = new Map<string, number>();
  for (const e of events) byModel.set(e.model || "—", (byModel.get(e.model || "—") ?? 0) + 1);

  return {
    total: events.length,
    errors,
    errorRate: events.length ? errors / events.length : 0,
    last24h: events.filter((e) => e.ts >= dayAgo).length,
    totalTokens: ok.reduce((s, e) => s + (e.tokens || 0), 0),
    avgTtftMs: avg(ok.map((e) => e.ttftMs || 0).filter((n) => n > 0)),
    avgTotalMs: avg(ok.map((e) => e.totalMs || 0)),
    avgTokS: tokS.length ? Math.round((tokS.reduce((s, n) => s + n, 0) / tokS.length) * 10) / 10 : 0,
    byModel: [...byModel.entries()]
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}
