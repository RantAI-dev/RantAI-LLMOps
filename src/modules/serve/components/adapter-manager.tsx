"use client";

import { useState } from "react";
import { Layers, Loader2, Plus, Puzzle, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/tooltip";
import { useAdapters, type AvailableAdapter } from "@/modules/serve/hooks/use-adapters";

/**
 * Attach / detach LoRA adapters on the vLLM base, on the Deployments page.
 *
 * One base model + many swappable adapters, each routed to per request via the
 * `model` field. Backed by /api/adapters -> vLLM's runtime LoRA API, so changes
 * are live (no redeploy). Hidden entirely unless vLLM is the configured engine.
 */
export function AdapterManager() {
  const { configured, reachable, base, served, available, loading, busy, error, clearError, reload, attach, detach } =
    useAdapters();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  // Ollama-only deployments never see this — nothing to manage.
  if (!loading && !configured) return null;

  const doRefresh = async () => {
    setRefreshing(true);
    try {
      await reload();
    } finally {
      setRefreshing(false);
    }
  };

  const canAttach = name.trim().length > 0 && path.trim().length > 0 && busy !== "__form__";

  const doAttach = async () => {
    const nm = name.trim();
    if (await attach(nm, path.trim())) {
      toast.success(`Attached adapter “${nm}”`);
      setName("");
      setPath("");
    }
  };

  const pickAvailable = (a: AvailableAdapter) => {
    setPath(a.path);
    if (!name.trim()) setName(a.jobId.slice(0, 8)); // a starting suggestion; the user renames it
  };

  return (
    <section className="rounded-xl border bg-surface p-5">
      <div className="mb-3 flex items-center gap-1.5">
        <Layers className="size-4 text-primary" />
        <h2 className="text-sm font-semibold text-ink">vLLM LoRA adapters</h2>
        <InfoTip label="About LoRA adapters">
          One base model, many swappable adapters. Clients route to one per request via the OpenAI
          <span className="font-mono"> model </span>
          field (e.g. base / asklearn / practice). Attach and detach are live — no redeploy.
        </InfoTip>
        {reachable && (
          <button
            type="button"
            onClick={doRefresh}
            disabled={refreshing}
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded p-1 text-ink-soft hover:bg-surface-soft disabled:opacity-50"
            title="Re-scan served + on-disk adapters"
          >
            <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] text-ink-soft">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : !reachable ? (
        <p className="text-[13px] leading-5 text-ink-soft">
          vLLM is configured but not reachable. Launch it with <span className="font-mono">--enable-lora</span> and{" "}
          <span className="font-mono">VLLM_ALLOW_RUNTIME_LORA_UPDATING=True</span> (see the compose stack), then
          redeploy.
        </p>
      ) : (
        <div className="space-y-5">
          <div className="text-[12px] text-ink-soft">
            Base model: <span className="font-mono text-ink">{base ?? "—"}</span>
          </div>

          {/* Attached adapters */}
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-ink-soft">
              Attached {served.length ? `(${served.length})` : "(none)"}
            </div>
            {served.length === 0 ? (
              <p className="text-[13px] text-ink-soft">No adapters attached — only the base is served.</p>
            ) : (
              <div className="space-y-1.5">
                {served.map((n) => (
                  <div key={n} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px]">
                    <Puzzle className="size-3.5 shrink-0 text-primary" />
                    <span className="truncate font-mono text-ink">{n}</span>
                    <span className="ml-1 hidden shrink-0 text-[11px] text-ink-soft sm:inline">
                      route with <span className="font-mono">model={n}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => detach(n)}
                      disabled={busy === n}
                      className="ml-auto inline-flex shrink-0 items-center gap-1 rounded p-1 text-ink-soft hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                      title={`Detach ${n}`}
                    >
                      {busy === n ? <Loader2 className="size-3.5 animate-spin" /> : <Unplug className="size-3.5" />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Attach */}
          <div>
            <div className="mb-1.5 text-[12px] font-medium text-ink-soft">Attach an adapter</div>

            {error && (
              <div className="mb-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[12px] text-danger">
                {error}{" "}
                <button type="button" onClick={clearError} className="ml-1 underline">
                  dismiss
                </button>
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name (e.g. practice)"
                className="min-w-0 rounded-lg border px-3 py-2 text-[13px] outline-none focus:border-primary sm:w-44"
              />
              <input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="Adapter dir (/root/.transformerlab/…)"
                className="min-w-0 flex-1 rounded-lg border px-3 py-2 font-mono text-[12px] outline-none focus:border-primary"
                onKeyDown={(e) => e.key === "Enter" && canAttach && doAttach()}
              />
              <Button onClick={doAttach} disabled={!canAttach} size="sm">
                {busy === "__form__" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Attach
              </Button>
            </div>

            {available.length > 0 && (
              <div className="mt-2.5">
                <div className="mb-1 text-[11px] text-ink-faint">Trained adapters on disk — click to fill the path:</div>
                <div className="flex flex-wrap gap-1.5">
                  {available.map((a) => (
                    <button
                      key={a.path}
                      type="button"
                      onClick={() => pickAvailable(a)}
                      title={`${a.path}\nbase: ${a.base}`}
                      className="rounded-full border px-2 py-0.5 font-mono text-[11px] text-ink-soft hover:bg-surface-soft"
                    >
                      {a.jobId.slice(0, 8)} · {a.base.split("/").pop() || "?"}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
