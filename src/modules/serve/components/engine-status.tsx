"use client";

import { CheckCircle2, CircleDashed, CircleAlert, Cpu } from "lucide-react";

import { InfoTip } from "@/components/ui/tooltip";
import { useEngines, type EngineInfo } from "@/modules/serve/hooks/use-engines";
import { cn } from "@/lib/utils";

/** What each engine is for, in the user's terms — not how it's wired. */
const ENGINE_BLURB: Record<string, string> = {
  ollama: "Fast & simple. Serves every downloaded GGUF model at once.",
  vllm: "Full precision (safetensors) & high request concurrency. Serves one model.",
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

      {/* vLLM serves one model per instance by design — say so, so its fixed
          model doesn't read as a limitation of this app. */}
      {engine.configured && engine.id === "vllm" ? (
        <p className="mt-2 text-[11px] leading-4 text-ink-faint">
          vLLM serves one model per instance. Change the model via{" "}
          <span className="font-mono">VLLM_MODEL</span> (a Hugging Face id or fine-tune path), then redeploy.
        </p>
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
