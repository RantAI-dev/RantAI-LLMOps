"use client";

import { CheckCircle2, CircleDashed, CircleAlert, Cpu } from "lucide-react";

import { useEngines, type EngineInfo } from "@/modules/serve/hooks/use-engines";
import { cn } from "@/lib/utils";

/** What each engine is for, in the user's terms — not how it's wired. */
const ENGINE_BLURB: Record<string, string> = {
  ollama: "Cepat & mudah. Melayani semua model GGUF yang sudah ditarik sekaligus.",
  vllm: "Presisi penuh (safetensors) & banyak permintaan paralel. Melayani satu model.",
};

type Status = { label: string; tone: "ok" | "off" | "warn"; icon: typeof CheckCircle2 };

function statusOf(e: EngineInfo): Status {
  if (!e.configured) return { label: "Belum dikonfigurasi", tone: "off", icon: CircleDashed };
  if (!e.available) return { label: "Tidak terjangkau", tone: "warn", icon: CircleAlert };
  return { label: "Aktif", tone: "ok", icon: CheckCircle2 };
}

function EngineCard({ engine }: { engine: EngineInfo }) {
  const s = statusOf(engine);
  const Icon = s.icon;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-ink-soft" aria-hidden />
          <h3 className="text-sm font-semibold text-ink">{engine.label}</h3>
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

      <p className="mt-1.5 text-[12px] leading-4 text-ink-soft">{ENGINE_BLURB[engine.id] ?? ""}</p>

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
              <span className="text-ink-soft"> · aktif: {engine.loaded.split("/").pop()}</span>
            ) : null}
          </dd>
        </dl>
      ) : (
        <p className="mt-3 rounded-md bg-surface-2 px-2.5 py-1.5 text-[11px] text-ink-soft">
          Set <span className="font-mono">VLLM_BASE_URL</span> ke endpoint vLLM (mis.
          <span className="font-mono"> http://host:8001/v1</span>) untuk mengaktifkan, lalu deploy ulang.
        </p>
      )}
    </div>
  );
}

/** The inference engines and their live status, on the Deployments page. */
export function EngineStatus() {
  const { engines, loading } = useEngines();
  if (loading || engines.length === 0) return null;
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-primary">Engine inference</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {engines.map((e) => (
          <EngineCard key={e.id} engine={e} />
        ))}
      </div>
    </div>
  );
}
