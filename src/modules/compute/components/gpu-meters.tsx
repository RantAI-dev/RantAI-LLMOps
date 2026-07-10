"use client";

import { Cpu } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

type GpuMetric = {
  index: number;
  name: string;
  utilGpu: number;
  memUsedMb: number;
  memTotalMb: number;
  tempC: number | null;
  powerW: number | null;
};

function Bar({ pct, className }: { pct: number; className: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className={cn("h-full rounded-full transition-[width] duration-500", className)}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

/**
 * Live GPU telemetry (nvidia-smi via `/api/compute/gpu-metrics`), polled while
 * mounted. Used on the Compute page and, in `compact` form, inside the training
 * monitor so loss + GPU load can be watched together.
 */
export function GpuMeters({
  intervalMs = 2500,
  compact = false,
}: {
  intervalMs?: number;
  compact?: boolean;
}) {
  const [gpus, setGpus] = useState<GpuMetric[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/compute/gpu-metrics", { cache: "no-store" });
        const d = (await res.json()) as { gpus?: GpuMetric[] };
        if (!cancelled) setGpus(Array.isArray(d.gpus) ? d.gpus : []);
      } catch {
        /* keep last reading on a transient error */
      }
    };
    void load();
    const t = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [intervalMs]);

  if (gpus === null) {
    return <p className="text-[12px] text-ink-soft">Membaca GPU…</p>;
  }
  if (gpus.length === 0) {
    return (
      <p className="text-[12px] text-ink-soft">
        Tak ada GPU NVIDIA terdeteksi (atau <code>nvidia-smi</code> tak tersedia di host).
      </p>
    );
  }

  return (
    <div className={cn(compact ? "space-y-2" : "space-y-3")}>
      {gpus.map((g) => {
        const memPct = g.memTotalMb ? (g.memUsedMb / g.memTotalMb) * 100 : 0;
        return (
          <div
            key={g.index}
            className={cn(
              "rounded-lg border border-hairline-2 bg-background",
              compact ? "p-2" : "p-3"
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <Cpu className="size-3.5 shrink-0 text-accent" aria-hidden />
                <span className="truncate text-[12px] font-medium text-ink">
                  GPU {g.index} · {g.name}
                </span>
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-ink-soft">
                {g.tempC != null ? `${g.tempC}°C` : "—"}
                {g.powerW != null ? ` · ${Math.round(g.powerW)}W` : ""}
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <div className="mb-1 flex justify-between text-[11px] text-ink-soft">
                  <span>GPU util</span>
                  <span className="tabular-nums text-ink">{g.utilGpu}%</span>
                </div>
                <Bar pct={g.utilGpu} className="bg-accent" />
              </div>
              <div>
                <div className="mb-1 flex justify-between text-[11px] text-ink-soft">
                  <span>VRAM</span>
                  <span className="tabular-nums text-ink">
                    {(g.memUsedMb / 1024).toFixed(1)} / {(g.memTotalMb / 1024).toFixed(1)} GB
                  </span>
                </div>
                <Bar pct={memPct} className={memPct > 90 ? "bg-danger" : "bg-success-solid"} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
