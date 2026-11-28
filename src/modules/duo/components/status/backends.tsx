"use client";

import { ArrowRightLeft, Server } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { Note, Panel, Pill, Spinner, arr, fmtInt, fmtMs, rec, str } from "@/modules/duo/components/duo-ui";
import { engineName } from "@/modules/duo/components/status/words";
import { gw } from "@/modules/duo/lib/gw";

type Rec = Record<string, unknown>;
type Target = { body: Rec; label: string };

/** One model of an engine. A spare engine (not in use) whose models are not running is shown as off, not as a fault. */
function RoleRow({ h, name, spare = false }: { h: Rec; name: string; spare?: boolean }) {
  const ok = h.ok === true;
  const off = !ok && spare;
  const inFlight = typeof h.in_flight === "number" ? h.in_flight : null;
  const max = typeof h.max_in_flight === "number" ? h.max_in_flight : null;
  return (
    <div className="space-y-0.5 rounded-md border border-hairline bg-background px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={cn("size-2 rounded-full", ok ? "bg-success" : off ? "bg-ink-faint" : "bg-danger")} aria-hidden />
        <span className="font-medium text-primary">{name}</span>
        <span className="min-w-0 flex-1 truncate text-ink-soft" title={str(h.hf_id, "")}>
          {str(h.hf_id, "") || str(h.model)}
        </span>
        <Pill tone={ok ? "good" : off ? "neutral" : "bad"}>{ok ? "Ready" : off ? "Not started" : "Not reachable"}</Pill>
      </div>
      <p className="pl-4 text-xs text-ink-faint">
        {inFlight !== null && max !== null ? `${inFlight} of ${max} answer slots busy` : "Slots unknown"}
        {typeof h.latency_ms === "number" ? ` · answered the health check in ${fmtMs(h.latency_ms)}` : ""}
        {str(h.weights, "") ? ` · weights ${str(h.weights)}` : ""}
        {str(h.url, "") ? ` · ${str(h.url)}` : ""}
      </p>
      {!ok && !off && str(h.error, "") ? <p className="pl-4 text-xs text-danger">{str(h.error)}</p> : null}
    </div>
  );
}

const engineInUse = (b: Rec) => b.active === true || b.serves_system1 === true || b.serves_system2 === true;

/** The model servers the gateway knows, with live health, and switching between them (guarded by a confirmation). */
export function Backends({ system, onChanged }: { system: Rec; onChanged: () => void }) {
  const backends = arr(system.backends);
  const active = str(system.active_backend, "");
  const ae = rec(system.active_engines);
  const [target, setTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);
  const a1 = str(ae.system1, "");
  const a2 = str(ae.system2, "");
  const [s1, setS1] = useState(a1);
  const [s2, setS2] = useState(a2);
  // The engines in use changed (a switch here, or the reloaded system data): the choices follow them, so "Use these"
  // does not offer to switch back (adjusted during render, not in an effect).
  const [seen, setSeen] = useState(`${a1}|${a2}`);
  if (seen !== `${a1}|${a2}`) {
    setSeen(`${a1}|${a2}`);
    setS1(a1);
    setS2(a2);
  }
  const byName = (n: string) => backends.find((b) => b.name === n);
  const label = (n: string) => engineName(byName(n)?.kind ?? n);

  async function apply() {
    if (!target) return;
    setBusy(true);
    try {
      const r = rec(await gw("/v1/system/backend", { method: "POST", body: target.body }));
      const warmed = typeof r.warmed_prefixes === "number" ? r.warmed_prefixes : 0;
      toast.success(`Switched: System 1 on ${label(str(r.system1_engine, ""))}, System 2 on ${label(str(r.system2_engine, ""))}${warmed ? ` (${warmed} prompts warmed)` : ""}`);
      const e1 = str(r.system1_engine, "");
      const e2 = str(r.system2_engine, "");
      if (e1) setS1(e1);
      if (e2) setS2(e2);
      setTarget(null);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Models and engines" info="The servers that run System 1 (the quick model) and System 2 (the reasoning model), checked live." actions={<Pill>In use: {active || "–"}</Pill>}>
      {backends.length === 0 ? (
        <EmptyState icon={Server} title="No model servers reported" description="The gateway did not list any backends." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {[...backends].sort((x, y) => Number(engineInUse(y)) - Number(engineInUse(x))).map((b) => {
            const name = str(b.name, "");
            const inUse = engineInUse(b);
            const both = rec(b.system1).ok === true && rec(b.system2).ok === true;
            return (
              <div key={name} className="space-y-2 rounded-lg border border-hairline p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-primary" title={str(b.label, "")}>
                    {engineName(b.kind)}
                  </h3>
                  <span className="text-xs text-ink-faint">{str(b.label, name)}</span>
                  <span className="flex-1" />
                  {b.active === true ? (
                    <Pill tone="good">In use</Pill>
                  ) : inUse ? (
                    <Pill tone="good">In use for {b.serves_system1 === true ? "System 1" : "System 2"}</Pill>
                  ) : backends.length > 1 ? (
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={!both}
                      title={both ? "Send new questions to this engine" : "Its models are not running; start them first"}
                      onClick={() => setTarget({ body: { name }, label: `both models on ${engineName(b.kind)}` })}
                    >
                      <ArrowRightLeft /> {both ? "Switch to this" : "Not running"}
                    </Button>
                  ) : null}
                </div>
                <RoleRow h={rec(b.system1)} name="System 1" spare={!inUse} />
                <RoleRow h={rec(b.system2)} name="System 2" spare={!inUse} />
              </div>
            );
          })}
        </div>
      )}

      {backends.length > 1 ? (
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-hairline pt-3">
          <p className="w-full text-xs text-ink-soft">System 1 and System 2 can run on different engines.</p>
          {(
            [
              ["System 1", "system1", s1, setS1],
              ["System 2", "system2", s2, setS2],
            ] as const
          ).map(([lab, role, v, set]) => (
            <label key={role} className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
              {lab}
              <select value={v} onChange={(e) => set(e.target.value)} className="h-8 rounded-[var(--radius-md)] border border-input bg-background px-2 text-sm text-ink">
                {backends.map((b) => {
                  const ok = rec(b[role]).ok === true;
                  return (
                    <option key={str(b.name, "")} value={str(b.name, "")} disabled={!ok}>
                      {engineName(b.kind)}
                      {ok ? "" : " (not running)"}
                    </option>
                  );
                })}
              </select>
            </label>
          ))}
          <Button
            size="sm"
            variant="outline"
            disabled={!s1 || !s2 || (s1 === a1 && s2 === a2)}
            onClick={() => setTarget({ body: { system1: s1, system2: s2 }, label: `System 1 on ${label(s1)} and System 2 on ${label(s2)}` })}
          >
            Use these
          </Button>
        </div>
      ) : backends.length === 1 ? (
        <Note className="mt-3">
          Only one engine is configured on this gateway ({engineName(backends[0].kind)}), so there is nothing to switch to. To change the models themselves,
          use{" "}
          <Link href="/duo/models" className="text-primary underline-offset-2 hover:underline">
            Models
          </Link>
          .
        </Note>
      ) : null}

      <Dialog open={target !== null} onOpenChange={(o) => !busy && !o && setTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Switch the model servers?</DialogTitle>
            <DialogDescription>This changes where every new question goes: {target?.label}.</DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink-soft">
            <li>The new engine is warmed first, so its first answers are not slower.</li>
            <li>Answers already in progress finish where they started; nothing is interrupted or sent again.</li>
            <li>It applies to everyone using Semantic Duo, until it is switched back. A restart of the gateway returns to its configured engine.</li>
            <li>It is refused if the new engine&apos;s models do not answer a health check.</li>
          </ul>
          {typeof system.inflight === "number" && system.inflight > 0 ? (
            <Note tone="info">{fmtInt(system.inflight)} answers are in progress right now.</Note>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={apply} disabled={busy}>
              {busy ? <Spinner className="text-primary-foreground" /> : <ArrowRightLeft />}
              Switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
