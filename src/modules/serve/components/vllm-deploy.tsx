"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Rocket, Server, Square, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/tooltip";
import { useVllmDeploy, type VllmAdapter } from "@/modules/serve/hooks/use-vllm-deploy";

/** What differs between the engines this card deploys; the form is shared. */
const ENGINES = {
  vllm: {
    label: "vLLM",
    route: "/api/serve/vllm",
    memLabel: "GPU util",
    memDefault: "0.30",
    showPort: true,
    about:
      "Serve a base model + LoRA adapters over vLLM, launched through the platform's compute provider — portable (no Docker socket), the same way training runs. One serving at a time.",
  },
  sglang: {
    label: "SGLang",
    route: "/api/serve/sglang",
    memLabel: "GPU mem (free)",
    memDefault: "0.38",
    showPort: false,
    about:
      "Serve a base model + LoRA adapters over SGLang in a managed container (needs the Docker socket). Faster than vLLM with many users at once. The GPU memory share is taken from the memory that is free when it starts. One serving at a time.",
  },
} as const;

/**
 * Deploy vLLM / SGLang — pick a base model + LoRA adapters and serve them, from
 * the UI. vLLM launches through TL's compute provider (portable) or a container;
 * SGLang always runs as a managed container. One deployment per engine (MVP).
 */
export function VllmDeploy({ engine = "vllm" }: { engine?: keyof typeof ENGINES }) {
  const cfg = ENGINES[engine];
  const { data, loading, busy, error, setError, deploy, stop } = useVllmDeploy(cfg.route);

  const [baseModel, setBaseModel] = useState("");
  const [servedName, setServedName] = useState("base");
  const [adapters, setAdapters] = useState<VllmAdapter[]>([]);
  const [aName, setAName] = useState("");
  const [aPath, setAPath] = useState("");
  const [gpuUtil, setGpuUtil] = useState<string>(cfg.memDefault);
  const [maxLen, setMaxLen] = useState("8192");
  const [quant, setQuant] = useState("");
  const [port, setPort] = useState("8001");
  const [downloaded, setDownloaded] = useState<string[]>([]);

  // Populate a base-model datalist from the models the backend already has.
  useEffect(() => {
    fetch("/api/models/catalog", { cache: "no-store" })
      .then((r) => r.json())
      .then((c: { downloaded?: { id: string }[] }) =>
        setDownloaded((c.downloaded ?? []).map((m) => m.id).filter(Boolean))
      )
      .catch(() => {});
  }, []);

  const dep = data?.deployment ?? null;
  const status = data?.status ?? "NONE";

  const addAdapter = () => {
    const name = aName.trim();
    const path = aPath.trim();
    if (!name || !path) return;
    if (adapters.some((a) => a.name === name)) {
      toast.error(`Adapter name “${name}” already added`);
      return;
    }
    setAdapters([...adapters, { name, path }]);
    setAName("");
    setAPath("");
  };

  const doDeploy = async () => {
    if (!baseModel.trim()) {
      toast.error("Pick a base model first");
      return;
    }
    const ok = await deploy({
      baseModel: baseModel.trim(),
      servedName: servedName.trim() || "base",
      adapters,
      gpuUtil,
      maxModelLen: maxLen,
      quant: quant.trim(),
      port: Number(port) || 8001,
    });
    if (ok) toast.success(`${cfg.label} deployment launched — starting up…`);
  };

  const doStop = async () => {
    await stop();
    toast.success(`${cfg.label} deployment stopped`);
  };

  const dot =
    status === "RUNNING"
      ? "bg-ok"
      : status === "FAILED"
        ? "bg-danger"
        : status === "COMPLETE" || status === "STOPPED" || status === "NONE"
          ? "bg-ink-faint"
          : "bg-warn";

  return (
    <section className="rounded-xl border bg-surface p-5">
      <div className="mb-3 flex items-center gap-1.5">
        <Server className="size-4 text-primary" />
        <h2 className="text-sm font-semibold text-ink">Deploy {cfg.label}</h2>
        <InfoTip label={`About Deploy ${cfg.label}`}>{cfg.about}</InfoTip>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px] text-ink-soft">
          <Loader2 className="size-4 animate-spin" /> Loading…
        </div>
      ) : dep ? (
        /* ── Current deployment ─────────────────────────────────────────── */
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[13px]">
            <span className={`size-2 rounded-full ${dot}`} />
            <span className="font-medium text-ink">{status}</span>
            <span className="text-ink-soft">·</span>
            <span className="truncate font-mono text-[12px] text-ink">{dep.baseModel}</span>
            <span className="ml-1 rounded border px-1.5 py-0.5 text-[11px] text-ink-soft">as {dep.servedName}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {dep.adapters.length === 0 ? (
              <span className="text-[12px] text-ink-soft">No adapters — base only.</span>
            ) : (
              dep.adapters.map((a) => (
                <span key={a.name} className="rounded-full border px-2 py-0.5 font-mono text-[11px] text-ink-soft">
                  {a.name}
                </span>
              ))
            )}
          </div>
          <div className="text-[12px] text-ink-soft">
            Served at <span className="font-mono text-ink">{data?.servedUrl}</span> · GPU {dep.gpuUtil} · ctx{" "}
            {dep.maxModelLen}
            {dep.quant ? ` · ${dep.quant}` : ""}
          </div>
          <Button variant="outline" size="sm" onClick={doStop} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-4" />}
            Stop deployment
          </Button>
        </div>
      ) : (
        /* ── Deploy form ────────────────────────────────────────────────── */
        <div className="space-y-4">
          {error && (
            <div className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[12px] text-danger">
              {error}{" "}
              <button type="button" onClick={() => setError(null)} className="ml-1 underline">
                dismiss
              </button>
            </div>
          )}

          <div>
            <div className="mb-1 text-[12px] font-medium text-ink-soft">Base model</div>
            <input
              value={baseModel}
              onChange={(e) => setBaseModel(e.target.value)}
              list={`${engine}-base-models`}
              placeholder="HF id or local path (e.g. aisingapore/Gemma-SEA-LION-v4-4B-VL)"
              className="w-full rounded-lg border px-3 py-2 font-mono text-[12px] outline-none focus:border-primary"
            />
            <datalist id={`${engine}-base-models`}>
              {downloaded.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>

          <div>
            <div className="mb-1 text-[12px] font-medium text-ink-soft">
              LoRA adapters {adapters.length ? `(${adapters.length})` : "(optional)"}
            </div>
            {adapters.length > 0 && (
              <div className="mb-2 space-y-1.5">
                {adapters.map((a) => (
                  <div key={a.name} className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[12px]">
                    <span className="font-mono text-ink">{a.name}</span>
                    <span className="truncate font-mono text-[11px] text-ink-soft">{a.path}</span>
                    <button
                      type="button"
                      onClick={() => setAdapters(adapters.filter((x) => x.name !== a.name))}
                      className="ml-auto rounded p-0.5 text-ink-soft hover:bg-danger-soft hover:text-danger"
                      title="Remove"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={aName}
                onChange={(e) => setAName(e.target.value)}
                placeholder="name (e.g. ask)"
                className="min-w-0 rounded-lg border px-3 py-2 text-[13px] outline-none focus:border-primary sm:w-36"
              />
              <input
                value={aPath}
                onChange={(e) => setAPath(e.target.value)}
                placeholder="adapter dir (/root/.transformerlab/…)"
                className="min-w-0 flex-1 rounded-lg border px-3 py-2 font-mono text-[12px] outline-none focus:border-primary"
                onKeyDown={(e) => e.key === "Enter" && addAdapter()}
              />
              <Button variant="outline" size="sm" onClick={addAdapter} disabled={!aName.trim() || !aPath.trim()}>
                <Plus className="size-4" /> Add
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label={cfg.memLabel} value={gpuUtil} onChange={setGpuUtil} placeholder={cfg.memDefault} />
            <Field label="Max ctx" value={maxLen} onChange={setMaxLen} placeholder="8192" />
            <Field label="Quant" value={quant} onChange={setQuant} placeholder="(none)" />
            {cfg.showPort && <Field label="Port" value={port} onChange={setPort} placeholder="8001" />}
          </div>

          <Button onClick={doDeploy} disabled={busy || !baseModel.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
            Deploy {cfg.label}
          </Button>
        </div>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-ink-faint">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-primary"
      />
    </label>
  );
}
