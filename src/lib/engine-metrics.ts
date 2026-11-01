/**
 * Live load of the vLLM and SGLang engines, read from their Prometheus
 * `/metrics` endpoint (both expose one at the server root; SGLang needs
 * `--enable-metrics`, which the managed container sets). Ollama has none.
 *
 * Counters are totals since the engine started; the UI turns two snapshots into
 * rates (output tokens per second). Metric names were checked against the box's
 * vLLM 0.11+ and SGLang builds (2026-11-01).
 */
import { resolveEngine, type EngineId } from "@/lib/inference-engines";

/** Sum of every sample per metric name (labels ignored): one engine, so one series per gauge. */
export function parsePrometheus(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const brace = line.indexOf("{");
    const space = line.lastIndexOf(" ");
    if (space < 0) continue;
    const name = brace >= 0 && brace < space ? line.slice(0, brace) : line.slice(0, line.indexOf(" "));
    const value = Number(line.slice(space + 1));
    if (!name || !Number.isFinite(value)) continue;
    out.set(name, (out.get(name) ?? 0) + value);
  }
  return out;
}

export type EngineMetrics = {
  /** Requests being generated now. */
  running: number;
  /** Requests waiting for a slot. */
  waiting: number;
  /** Share of the KV cache in use, 0–1. */
  kvCacheUsage: number | null;
  /** Totals since the engine started. */
  requests: number;
  promptTokens: number;
  generationTokens: number;
  /** Averages since the engine started. */
  avgTtftMs: number | null;
  avgLatencyMs: number | null;
  /** Share of prompt tokens served from the prefix cache, 0–1. */
  prefixCacheHitRate: number | null;
  /** SGLang's LoRA memory pool. */
  loraSlots: { used: number; total: number } | null;
};

const ratio = (num: number | undefined, den: number | undefined): number | null =>
  num !== undefined && den ? num / den : null;

/** The fields the UI shows, from one `/metrics` scrape. */
export function summarizeMetrics(engine: "vllm" | "sglang", m: Map<string, number>): EngineMetrics {
  const g = (k: string) => m.get(k);
  const n = (k: string) => m.get(k) ?? 0;
  const ms = (sum: string, count: string) => {
    const r = ratio(g(sum), g(count));
    return r === null ? null : Math.round(r * 1000);
  };
  if (engine === "vllm") {
    return {
      running: n("vllm:num_requests_running"),
      waiting: n("vllm:num_requests_waiting"),
      // Renamed from gpu_cache_usage_perc in newer vLLM; both are a 0–1 share despite the name.
      kvCacheUsage: g("vllm:kv_cache_usage_perc") ?? g("vllm:gpu_cache_usage_perc") ?? null,
      requests: n("vllm:e2e_request_latency_seconds_count"),
      promptTokens: n("vllm:prompt_tokens_total"),
      generationTokens: n("vllm:generation_tokens_total"),
      avgTtftMs: ms("vllm:time_to_first_token_seconds_sum", "vllm:time_to_first_token_seconds_count"),
      avgLatencyMs: ms("vllm:e2e_request_latency_seconds_sum", "vllm:e2e_request_latency_seconds_count"),
      prefixCacheHitRate: ratio(g("vllm:prefix_cache_hits_total"), g("vllm:prefix_cache_queries_total")),
      loraSlots: null,
    };
  }
  const loraTotal = g("sglang:lora_pool_slots_total");
  return {
    running: n("sglang:num_running_reqs"),
    waiting: n("sglang:num_queue_reqs"),
    kvCacheUsage: g("sglang:token_usage") ?? null,
    requests: n("sglang:e2e_request_latency_seconds_count"),
    promptTokens: n("sglang:prompt_tokens_total"),
    generationTokens: n("sglang:generation_tokens_total"),
    avgTtftMs: ms("sglang:time_to_first_token_seconds_sum", "sglang:time_to_first_token_seconds_count"),
    avgLatencyMs: ms("sglang:e2e_request_latency_seconds_sum", "sglang:e2e_request_latency_seconds_count"),
    prefixCacheHitRate: ratio(g("sglang:cached_tokens_total"), g("sglang:prompt_tokens_total")),
    loraSlots: loraTotal ? { used: n("sglang:lora_pool_slots_used"), total: loraTotal } : null,
  };
}

export type EngineMetricsReport = {
  id: Extract<EngineId, "vllm" | "sglang">;
  label: string;
  configured: boolean;
  reachable: boolean;
  metrics: EngineMetrics | null;
  error?: string;
};

/** Scrape one engine. Never throws: an unreachable engine reports reachable=false. */
export async function scrapeEngineMetrics(id: "vllm" | "sglang"): Promise<EngineMetricsReport> {
  const engine = resolveEngine(id);
  const base = { id, label: engine.label, configured: engine.configured };
  if (!engine.configured) return { ...base, reachable: false, metrics: null };
  const root = engine.v1BaseUrl.replace(/\/v1\/?$/, "");
  try {
    const res = await fetch(`${root}/metrics`, { headers: engine.headers, signal: AbortSignal.timeout(4000) });
    if (!res.ok) {
      const hint = res.status === 404 && id === "sglang" ? " (start SGLang with --enable-metrics)" : "";
      return { ...base, reachable: true, metrics: null, error: `/metrics returned ${res.status}${hint}` };
    }
    return { ...base, reachable: true, metrics: summarizeMetrics(id, parsePrometheus(await res.text())) };
  } catch (err) {
    return { ...base, reachable: false, metrics: null, error: err instanceof Error ? err.message : "unreachable" };
  }
}
