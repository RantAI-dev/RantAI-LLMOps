"use client";

import { Gauge } from "lucide-react";

import { InfoTip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useEngineMetrics, type LiveEngine } from "@/modules/traces/hooks/use-engine-metrics";

const fmtInt = (n: number): string => new Intl.NumberFormat("id-ID").format(Math.round(n));
const fmtMs = (ms: number | null): string => (ms === null ? "—" : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
const fmtPct = (r: number | null): string => (r === null ? "—" : `${Math.round(r * 100)}%`);

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className={cn("text-lg font-semibold tabular-nums leading-7", warn ? "text-warning" : "text-ink")}>{value}</div>
    </div>
  );
}

function EngineCard({ e }: { e: LiveEngine }) {
  const m = e.metrics;
  const kv = m?.kvCacheUsage ?? null;
  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold text-ink">{e.label}</span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
            m ? "bg-success-soft text-success-bright" : "bg-danger-soft text-danger"
          )}
        >
          <span className={cn("size-1.5 rounded-full", m ? "bg-success-bright" : "bg-danger")} />
          {m ? "Live" : e.reachable ? "No metrics" : "Unreachable"}
        </span>
      </div>

      {!m ? (
        <p className="text-[12px] text-ink-soft">{e.error ?? "No data."}</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Running" value={fmtInt(m.running)} />
            <Stat label="Waiting" value={fmtInt(m.waiting)} warn={m.waiting > 0} />
            <Stat label="Output tok/s" value={e.outTokS === null ? "…" : e.outTokS.toFixed(1)} />
            <Stat label="Avg TTFT" value={fmtMs(m.avgTtftMs)} />
          </div>

          <div>
            <div className="mb-1 flex justify-between text-[11px] text-ink-soft">
              <span>KV cache in use</span>
              <span className="tabular-nums">{fmtPct(kv)}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-border">
              <div
                className={cn("h-full rounded-full", kv !== null && kv > 0.9 ? "bg-warning" : "bg-primary")}
                style={{ width: `${Math.min(100, Math.max(0, (kv ?? 0) * 100))}%` }}
              />
            </div>
          </div>

          <p className="text-[11px] leading-4 text-ink-soft">
            Since the engine started: {fmtInt(m.requests)} requests · {fmtInt(m.promptTokens)} prompt /{" "}
            {fmtInt(m.generationTokens)} output tokens · avg {fmtMs(m.avgLatencyMs)} per request · prefix cache hit{" "}
            {fmtPct(m.prefixCacheHitRate)}
            {m.loraSlots ? ` · LoRA slots ${m.loraSlots.used}/${m.loraSlots.total}` : ""}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Live load of vLLM / SGLang from their `/metrics`, refreshed every 5 s.
 * Traces show what each request did; this shows what the engines are doing now.
 * Hidden when neither engine is configured (Ollama has no metrics).
 */
export function EngineLoad() {
  const engines = useEngineMetrics();
  if (!engines || engines.length === 0) return null;
  return (
    <section className="rounded-xl border bg-surface p-4">
      <div className="mb-3 flex items-center gap-1.5">
        <Gauge className="size-4 text-primary" />
        <h2 className="text-sm font-semibold text-ink">Engine load</h2>
        <InfoTip label="About engine load">
          Read from each engine&apos;s Prometheus /metrics every 5 seconds. Counters cover every request the
          engine served since it started, including traffic that did not go through LLMOps.
        </InfoTip>
        <span className="ml-auto text-[11px] text-ink-faint">live · every 5 s</span>
      </div>
      <div className={cn("grid gap-3", engines.length > 1 && "lg:grid-cols-2")}>
        {engines.map((e) => (
          <EngineCard key={e.id} e={e} />
        ))}
      </div>
    </section>
  );
}
