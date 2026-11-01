import { scrapeEngineMetrics } from "@/lib/engine-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — live load of the configured vLLM / SGLang engines from their Prometheus
 * `/metrics` (queue, KV cache, tokens, latency). Only configured engines are
 * returned; Ollama exposes no metrics. The Traces page polls this.
 */
export async function GET() {
  const engines = (await Promise.all([scrapeEngineMetrics("vllm"), scrapeEngineMetrics("sglang")])).filter(
    (e) => e.configured
  );
  return Response.json({ ts: Date.now(), engines });
}
