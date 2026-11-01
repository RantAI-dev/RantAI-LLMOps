import { describe, expect, it } from "vitest";

import { parsePrometheus, summarizeMetrics } from "@/lib/engine-metrics";

// Trimmed from the box's real /metrics (2026-11-01).
const VLLM = `# HELP vllm:num_requests_running Number of requests in model execution batches.
# TYPE vllm:num_requests_running gauge
vllm:num_requests_running{engine="0",model_name="base"} 2.0
vllm:num_requests_waiting{engine="0",model_name="base"} 1.0
vllm:kv_cache_usage_perc{engine="0",model_name="base"} 0.25
vllm:prompt_tokens_total{engine="0",model_name="base"} 819831.0
vllm:generation_tokens_total{engine="0",model_name="base"} 44496.0
vllm:prefix_cache_hits_total{engine="0",model_name="base"} 455856.0
vllm:prefix_cache_queries_total{engine="0",model_name="base"} 819831.0
vllm:time_to_first_token_seconds_sum{engine="0",model_name="base"} 569.1252336502075
vllm:time_to_first_token_seconds_count{engine="0",model_name="base"} 643.0
vllm:time_to_first_token_seconds_bucket{engine="0",le="0.001",model_name="base"} 0.0
vllm:e2e_request_latency_seconds_sum{engine="0",model_name="base"} 4057.8695616722107
vllm:e2e_request_latency_seconds_count{engine="0",model_name="base"} 643.0
vllm:lora_requests_info{max_lora="4",running_lora_adapters="ask",waiting_lora_adapters="ask"} 1.7935433349160986e+09`;

const SGLANG = `sglang:prompt_tokens_total{engine_type="unified",is_streaming="false",model_name="base"} 78.0
sglang:prompt_tokens_total{engine_type="unified",is_streaming="true",model_name="base"} 792.0
sglang:cached_tokens_total{engine_type="unified",model_name="base"} 435.0
sglang:generation_tokens_total{engine_type="unified",is_streaming="true",model_name="base"} 269.0
sglang:num_running_reqs{engine_type="unified",model_name="base",tp_rank="0"} 3.0
sglang:num_queue_reqs{engine_type="unified",model_name="base",tp_rank="0"} 0.0
sglang:token_usage{engine_type="unified",model_name="base",tp_rank="0"} 0.5
sglang:time_to_first_token_seconds_sum{engine_type="unified",is_streaming="false",model_name="base"} 6.0
sglang:time_to_first_token_seconds_sum{engine_type="unified",is_streaming="true",model_name="base"} 1.5
sglang:time_to_first_token_seconds_count{engine_type="unified",is_streaming="false",model_name="base"} 1.0
sglang:time_to_first_token_seconds_count{engine_type="unified",is_streaming="true",model_name="base"} 14.0
sglang:e2e_request_latency_seconds_sum{engine_type="unified",is_streaming="true",model_name="base"} 20.0
sglang:e2e_request_latency_seconds_count{engine_type="unified",is_streaming="true",model_name="base"} 10.0
sglang:lora_pool_slots_used{engine_type="unified",model_name="base"} 1.0
sglang:lora_pool_slots_total{engine_type="unified",model_name="base"} 8.0`;

describe("parsePrometheus", () => {
  it("sums the samples of each metric across labels and skips comments", () => {
    const m = parsePrometheus(SGLANG);
    expect(m.get("sglang:prompt_tokens_total")).toBe(870);
    expect(m.has("# HELP")).toBe(false);
    expect(parsePrometheus("up 1\nbad_line\n")).toEqual(new Map([["up", 1]]));
  });
});

describe("summarizeMetrics", () => {
  it("reads vLLM's queue, KV cache, latency and prefix cache", () => {
    const s = summarizeMetrics("vllm", parsePrometheus(VLLM));
    expect(s).toMatchObject({ running: 2, waiting: 1, kvCacheUsage: 0.25, requests: 643, generationTokens: 44496, loraSlots: null });
    expect(s.avgTtftMs).toBe(885);
    expect(s.avgLatencyMs).toBe(6311);
    expect(s.prefixCacheHitRate).toBeCloseTo(0.556, 3);
  });

  it("reads SGLang's queue, token usage, latency and LoRA pool", () => {
    const s = summarizeMetrics("sglang", parsePrometheus(SGLANG));
    expect(s).toMatchObject({ running: 3, waiting: 0, kvCacheUsage: 0.5, requests: 10, promptTokens: 870, loraSlots: { used: 1, total: 8 } });
    expect(s.avgTtftMs).toBe(500);
    expect(s.avgLatencyMs).toBe(2000);
    expect(s.prefixCacheHitRate).toBeCloseTo(0.5, 3);
  });

  it("reports unknown averages as null instead of dividing by zero", () => {
    const s = summarizeMetrics("vllm", parsePrometheus(""));
    expect(s.avgTtftMs).toBeNull();
    expect(s.kvCacheUsage).toBeNull();
    expect(s.prefixCacheHitRate).toBeNull();
  });
});
