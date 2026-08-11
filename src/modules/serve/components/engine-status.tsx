"use client";

import { CheckCircle2, CircleDashed, CircleAlert, Cpu } from "lucide-react";

import { InfoTip } from "@/components/ui/tooltip";
import { useEngines, type EngineInfo } from "@/modules/serve/hooks/use-engines";
import { cn } from "@/lib/utils";

/** What each engine is for, in the user's terms — not how it's wired. */
const ENGINE_BLURB: Record<string, string> = {
  ollama: "Fast & simple. Serves every downloaded GGUF model at once.",
  vllm: "Full precision (safetensors) & high concurrency. Serves a base model, plus LoRA adapters routed to per request.",
};

type Status = { label: string; tone: "ok" | "off" | "warn"; icon: typeof CheckCircle2 };

function statusOf(e: EngineInfo): Status {
  if (!e.configured) return { label: "Not configured", tone: "off", icon: CircleDashed };
  if (!e.available) return { label: "Unreachable", tone: "warn", icon: CircleAlert };
  return { label: "Active", tone: "ok", icon: CheckCircle2 };
}

function EngineCard({ engine }: { engine: EngineInfo }) {
  const s = statusOf(engine);
  const Icon = s.icon;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Cpu className="size-4 text-ink-soft" aria-hidden />
          <h3 className="text-sm font-semibold text-ink">{engine.label}</h3>
          {ENGINE_BLURB[engine.id] ? (
            <InfoTip label={`About ${engine.label}`}>{ENGINE_BLURB[engine.id]}</InfoTip>
          ) : null}
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
            s.tone === "ok" && "bg-success-soft text-success",
            s.tone === "warn" && "bg-warning-soft text-warning",
            s.tone === "off" && "bg-surface-2 text-ink-soft"
          )}
        >
          <Icon className="size-3" aria-hidden />
          {s.label}
        </span>
      </div>

      {engine.configured ? (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-ink-soft">Endpoint</dt>
          <dd className="truncate font-mono text-ink" title={engine.v1BaseUrl}>
            {engine.v1BaseUrl}
          </dd>
          <dt className="text-ink-soft">Model</dt>
          <dd className="text-ink tabular-nums">
            {engine.models.length}
            {engine.loaded ? (
              <span className="text-ink-soft"> · active: {engine.loaded.split("/").pop()}</span>
            ) : null}
          </dd>
        </dl>
      ) : null}

      {/* vLLM either serves a single fixed model, or a base + LoRA adapters the
          client routes to by `model` name. Show whichever is live. */}
      {engine.configured && engine.id === "vllm" ? (
        engine.models.length > 1 ? (
          <div className="mt-2">
            <p className="text-[11px] leading-4 text-ink-faint">
              Serving a base + {engine.models.length - 1} adapter
              {engine.models.length - 1 > 1 ? "s" : ""} — clients route by the{" "}
              <span className="font-mono">model</span> field, no reload.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {engine.models.map((m, i) => (
                <span
                  key={m.id}
                  title={i === 0 ? "base model" : "LoRA adapter"}
                  className={cn(
                    "rounded-full px-2 py-0.5 font-mono text-[11px]",
                    i === 0 ? "bg-surface-2 text-ink-soft" : "bg-success-soft text-success"
                  )}
                >
                  {m.name.split("/").pop()}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[11px] leading-4 text-ink-faint">
            Serving one model. Attach LoRA adapters with{" "}
            <span className="font-mono">VLLM_LORA_MODULES</span> (base + adapters, routed per
            request), or change it via <span className="font-mono">VLLM_MODEL</span>, then redeploy.
          </p>
        )
      ) : null}

      {!engine.configured ? (
        <p className="mt-3 rounded-md bg-surface-2 px-2.5 py-1.5 text-[11px] text-ink-soft">
          Set <span className="font-mono">VLLM_BASE_URL</span> to the vLLM endpoint (e.g.
          <span className="font-mono"> http://host:8001/v1</span>) to enable it, then redeploy.
        </p>
      ) : null}
    </div>
  );
}

/** The inference engines and their live status, on the Deployments page. */
export function EngineStatus() {
  const { engines, loading } = useEngines();
  if (loading || engines.length === 0) return null;
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-primary">Inference engines</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {engines.map((e) => (
          <EngineCard key={e.id} engine={e} />
        ))}
      </div>
    </div>
  );
}
