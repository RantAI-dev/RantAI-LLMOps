"use client";

import { RotateCcw, Upload } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { DuoRole, DuoRoleStatus } from "@/lib/duo-deploy";
import type { TrainedAdapter } from "@/lib/trained-adapters";
import { cn } from "@/lib/utils";
import { ConfirmButton } from "@/modules/duo/components/duo-ui";

type PairStatus = { docker: boolean; roles: Record<DuoRole, DuoRoleStatus>; adapters: TrainedAdapter[] };

const busy = (s: DuoRoleStatus) => s.job?.phase === "replacing" || s.job?.phase === "loading";
const jobId = (path: string | null) => (path ? (/jobs\/([^/]+)\//.exec(path)?.[1]?.slice(0, 8) ?? path) : null);

function RoleCard({ role, status, adapters, docker, onChanged }: { role: DuoRole; status: DuoRoleStatus; adapters: TrainedAdapter[]; docker: boolean; onChanged: () => void }) {
  const [base, setBase] = useState(status.baseModel ?? "");
  const [adapter, setAdapter] = useState(status.adapterPath ?? "");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const fitting = adapters.filter((a) => !base || a.base === base || a.base.endsWith(`/${base.split("/").pop()}`));

  async function post(body: Record<string, unknown>) {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/duo/deploy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }

  const job = status.job;
  const current = `${status.baseModel ?? "unknown model"}${status.adapterPath ? `, adapter ${jobId(status.adapterPath)}` : ""}`;
  return (
    <div className="rounded-lg border border-hairline bg-card p-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[14px] font-medium">{status.label}</h3>
        <span className={cn("rounded-full px-2 py-0.5 text-[11px]", status.answering ? "bg-muted text-ink" : "bg-muted text-destructive")}>
          {status.answering ? `answering as ${status.served}` : "not answering"}
        </span>
      </div>
      <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-[12px]">
        <dt className="text-ink-soft">Base model</dt>
        <dd>{status.baseModel ?? "–"}</dd>
        <dt className="text-ink-soft">Adapter</dt>
        <dd>{jobId(status.adapterPath) ?? "none"}</dd>
        <dt className="text-ink-soft">Context</dt>
        <dd>{status.maxModelLen ? `${status.maxModelLen} tokens` : "–"}</dd>
      </dl>
      {job && (
        <p className={cn("mt-2 text-[12px]", job.phase === "failed" || job.phase === "rolled_back" ? "text-destructive" : "text-ink-soft")}>
          {job.phase === "ready" ? "Done: " : job.phase === "failed" ? "Failed: " : job.phase === "rolled_back" ? "Rolled back: " : "Working: "}
          {job.message}
        </p>
      )}
      {docker && (
        <div className="mt-3 space-y-2 border-t border-hairline pt-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium">Base model (Hugging Face id)</span>
            <input value={base} onChange={(e) => setBase(e.target.value.trim())} className="h-8 w-full rounded-md border border-input bg-background px-2 text-[12px]" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium">LoRA adapter</span>
            <select value={adapter} onChange={(e) => setAdapter(e.target.value)} className="h-8 w-full rounded-md border border-input bg-background px-2 text-[12px]">
              <option value="">None (base model only)</option>
              {fitting.map((a) => (
                <option key={a.path} value={a.path}>
                  job {a.jobId.slice(0, 8)} ({a.base})
                </option>
              ))}
            </select>
          </label>
          {/* Both replace the live container that answers for this role, so each asks once more and says what goes. */}
          <div className="flex flex-wrap gap-2">
            <ConfirmButton
              variant="outline"
              disabled={sending || busy(status) || !base}
              onConfirm={() => post({ role, baseModel: base, adapterPath: adapter || null })}
              confirmLabel={`Click again: replaces ${status.label}`}
              title={`Replaces the running ${status.served} container (${current}) with ${base || "the base model"}${adapter ? ` and adapter ${jobId(adapter)}` : ""}. The previous container is kept and comes back if the new one does not answer.`}
            >
              <Upload className="mr-1 h-3.5 w-3.5" />
              Deploy
            </ConfirmButton>
            {status.hasPrevious && (
              <ConfirmButton
                variant="outline"
                disabled={sending || busy(status)}
                onConfirm={() => post({ role, action: "rollback" })}
                confirmLabel={`Click again: rolls ${status.label} back`}
                title={`Replaces the running ${status.served} container (${current}) with the previous one.`}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                Roll back
              </ConfirmButton>
            )}
          </div>
          {error && <p className="text-[12px] text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}

/** Which model and adapter serve System 1 and System 2, and changing them (the gateway keeps calling the same names). */
export function DuoPair() {
  const [status, setStatus] = useState<PairStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch("/api/duo/deploy")
      .then(async (res) => {
        const j = (await res.json()) as PairStatus & { error?: string };
        if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
        return j;
      })
      .then((j) => {
        if (!alive) return;
        setStatus(j);
        setError(null);
      })
      .catch((err: unknown) => {
        if (alive) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [tick]);

  // Follow a running deployment.
  const working = status ? busy(status.roles.s1) || busy(status.roles.s2) : false;
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, [working]);

  if (error && !status)
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-hairline px-4 py-2 text-xs text-destructive">
        <span className="flex-1">{error}</span>
        <Button size="xs" variant="outline" onClick={() => setTick((n) => n + 1)}>
          Try again
        </Button>
      </div>
    );
  if (!status) return <p className="text-[12px] text-ink-soft">Loading…</p>;
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-ink-soft">
        The gateway always calls <code>system1</code> and <code>system2</code>. Deploying replaces the vLLM container behind that name; the previous
        one is kept and comes back by itself if the new model does not answer.
      </p>
      {error && <p className="text-[12px] text-destructive">Could not refresh: {error}</p>}
      {!status.docker && (
        <p className="rounded-lg border border-hairline px-4 py-2 text-[12px] text-ink-soft">
          Read only: changing models needs the Duo deployer (DUO_DEPLOYER_URL, see docs/DEPLOY-PORTAINER.md).
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {(["s1", "s2"] as const).map((r) => (
          <RoleCard
            key={`${r}-${status.roles[r].baseModel}-${status.roles[r].adapterPath}`}
            role={r}
            status={status.roles[r]}
            adapters={status.adapters}
            docker={status.docker}
            onChanged={() => setTick((n) => n + 1)}
          />
        ))}
      </div>
    </div>
  );
}
