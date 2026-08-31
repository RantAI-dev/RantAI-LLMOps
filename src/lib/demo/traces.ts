/**
 * DEMO fixtures for the Traces view + Dashboard usage stats. Shapes mirror
 * `InferenceEvent` / `InferenceStats` in src/lib/inference-log-store.ts exactly,
 * so the real routes/UI render them unchanged. Timestamps are anchored to "now"
 * so the log always looks freshly active.
 */
import type { InferenceEvent, InferenceStats } from "@/lib/inference-log-store";
import { minutesAgo } from "@/lib/demo";

const MODELS: { model: string; engine: string }[] = [
  { model: "rantai-sealion-v3-ask:latest", engine: "vllm" },
  { model: "base", engine: "vllm" },
  { model: "ask", engine: "vllm" },
  { model: "learn", engine: "vllm" },
  { model: "practice", engine: "vllm" },
  { model: "rantai-amal-classifier-v4:latest", engine: "ollama" },
  { model: "qwen2.5:3b-instruct", engine: "ollama" },
];

/** Recent inference events, newest-first (index 0 = a few minutes ago). */
export function demoInferenceEvents(): InferenceEvent[] {
  // Deterministic PRNG so a single page load is stable, but anchored to `now`.
  let seed = 20260831;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const n = 64;
  const out: InferenceEvent[] = [];
  for (let i = 0; i < n; i++) {
    const m = MODELS[Math.floor(rnd() * MODELS.length)];
    const ct = 20 + Math.floor(rnd() * 620);
    const pt = 180 + Math.floor(rnd() * 1500);
    const totalMs = 380 + Math.floor(rnd() * 12000);
    const status: "ok" | "error" = rnd() < 0.08 ? "error" : "ok";
    // First few events within the last minutes; the rest fan out across ~24h.
    const ageMin = i < 4 ? i * 2 + Math.floor(rnd() * 2) : Math.floor(i * (1440 / n)) + Math.floor(rnd() * 4);
    out.push({
      ts: minutesAgo(ageMin),
      model: m.model,
      engine: m.engine,
      status,
      tokens: status === "ok" ? pt + ct : 0,
      promptTokens: pt,
      completionTokens: status === "ok" ? ct : 0,
      tokS: status === "ok" ? Math.round((ct / (totalMs / 1000)) * 10) / 10 : 0,
      ttftMs: m.engine === "vllm" ? 0 : 40 + Math.floor(rnd() * 3200),
      totalMs,
      finishReason: status === "ok" ? "stop" : "error",
    });
  }
  return out;
}

/** Aggregate usage stats — computed from the same events for consistency
 *  (mirrors getInferenceStats in inference-log-store.ts). */
export function demoInferenceStats(): InferenceStats {
  const events = demoInferenceEvents();
  const ok = events.filter((e) => e.status === "ok");
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const byModel = new Map<string, number>();
  for (const e of events) byModel.set(e.model, (byModel.get(e.model) ?? 0) + 1);
  const tokS = ok.map((e) => e.tokS).filter((n) => n > 0);
  const ttft = ok.map((e) => e.ttftMs).filter((n) => n > 0);
  const avg = (nums: number[]) => (nums.length ? Math.round(nums.reduce((s, n) => s + n, 0) / nums.length) : 0);
  return {
    total: events.length,
    errors: events.length - ok.length,
    errorRate: events.length ? (events.length - ok.length) / events.length : 0,
    last24h: events.filter((e) => e.ts >= dayAgo).length,
    totalTokens: ok.reduce((s, e) => s + (e.tokens || 0), 0),
    avgTtftMs: avg(ttft),
    avgTotalMs: avg(ok.map((e) => e.totalMs)),
    avgTokS: tokS.length ? Math.round((tokS.reduce((s, n) => s + n, 0) / tokS.length) * 10) / 10 : 0,
    byModel: [...byModel.entries()]
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}
