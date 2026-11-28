"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  GwErrorState,
  KV,
  Loading,
  Note,
  PageIntro,
  Panel,
  Pill,
  Spinner,
  Stat,
  StatGrid,
  arr,
  fmtAgo,
  fmtInt,
  fmtMs,
  fmtNum,
  fmtPct,
  rec,
  str,
} from "@/modules/duo/components/duo-ui";
import { Activity } from "@/modules/duo/components/status/activity";
import { Backends } from "@/modules/duo/components/status/backends";
import { ruleName } from "@/modules/duo/components/status/words";
import { useGw } from "@/modules/duo/lib/gw";

type Rec = Record<string, unknown>;
export const STATUS_REFRESH_MS = 15_000;
const TH = "whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-ink-soft";
const TD = "px-3 py-2";
const yes = (v: unknown, y = "Yes", n = "No") => (v === true ? y : v === false ? n : "–");
const plain = (v: unknown) => (typeof v === "number" ? fmtNum(v, Math.abs(v) < 10 ? 2 : 0) : str(v));

function Health({ health, system }: { health: Rec | null; system: Rec }) {
  const s = str(health?.status, "").toLowerCase();
  const ok = s === "ok";
  const roles = rec(health?.backends);
  return (
    <StatGrid>
      <Stat label="Gateway" value={health ? (ok ? "Ready" : "Degraded") : "–"} tone={health ? (ok ? "good" : "warn") : undefined} hint={`version ${str(system.version)}`} />
      <Stat label="System 1" value={str(roles.system1) === "ready" ? "Ready" : roles.system1 ? "Unavailable" : "–"} tone={roles.system1 === "ready" ? "good" : roles.system1 ? "bad" : undefined} />
      <Stat label="System 2" value={str(roles.system2) === "ready" ? "Ready" : roles.system2 ? "Unavailable" : "–"} tone={roles.system2 === "ready" ? "good" : roles.system2 ? "bad" : undefined} />
      <Stat label="Answers in progress" value={fmtInt(system.inflight)} hint={`up ${typeof system.uptime_s === "number" ? fmtMs(system.uptime_s * 1000) : "–"}`} />
    </StatGrid>
  );
}

function GateSettings({ system }: { system: Rec }) {
  const g = rec(system.gate);
  const st = rec(g.state);
  const cal = rec(st.calibration);
  const judge = rec(system.judge);
  const audit = rec(system.audit);
  const counts = Object.entries(rec(audit.counts));
  const fixed = st.effective_rule === "fixed";
  const fixedCfg = rec(g.fixed);
  return (
    <Panel title="Gate settings in force" actions={<Pill tone={fixed ? "warn" : "good"}>{ruleName(st.effective_rule)}</Pill>}>
      <KV
        rows={[
          [
            "How the gate decides",
            fixed
              ? "Calls System 2 when System 1's draft sounds unsure or its quick samples disagree"
              : st.effective_rule === "budget"
                ? `Calls System 2 for a fixed share of questions (${fmtPct(st.escalation_budget)}), the riskiest first`
                : "Calls System 2 when the predicted gain in accuracy is worth the extra time",
          ],
          ["Mode configured", `${ruleName(st.mode)}${st.mode !== st.effective_rule && st.effective_rule ? ` (falls back to ${ruleName(st.effective_rule).toLowerCase()} until a prediction is promoted)` : ""}`],
          ["Mistake prediction", `${st.promoted === true ? "Learned and in use" : "Starting estimate (not learned yet)"}${typeof cal.n === "number" && cal.n ? ` · from ${fmtInt(cal.n)} checked answers` : ""}`],
          ["Quick samples per question", fmtInt(g.k_samples)],
          ["Default speed weight (λ)", fmtNum(g.lambda_default, 2)],
          ["Cost of one wrong answer", typeof g.loss_wrong === "number" ? `${fmtNum(g.loss_wrong, 2)} (time unit ${fmtNum(g.cost_unit_s, 0)} s)` : "–"],
          Object.keys(fixedCfg).length ? ["Simple rule thresholds", Object.entries(fixedCfg).map(([k, v]) => `${k.replace(/_/g, " ")} ${plain(v)}`).join(" · ")] : null,
          ["Review of open answers", judge.enabled === true ? `On, up to ${fmtInt(judge.max_retries)} retry` : judge.enabled === false ? "Off" : "–"],
          ["Spot checks", `${fmtPct(g.audit_fraction)} of quick answers${counts.length ? ` · ${counts.map(([k, v]) => `${k} ${plain(v)}`).join(", ")}` : " · none yet"}`],
          typeof st.recalibrate_every_h === "number" ? ["Refit from the ledger", `every ${fmtInt(st.recalibrate_every_h)} h`] : null,
        ]}
      />
    </Panel>
  );
}

function Calibration({ system }: { system: Rec }) {
  const st = rec(rec(system.gate).state);
  const c = rec(st.calibration);
  const req = rec(st.requirements);
  return (
    <Panel
      title="Calibration"
      info="The gate's prediction of how likely System 1's draft is to be wrong. A new fit is promoted only if it is accurate on held-out answers and built from enough of them."
      actions={st.promoted === true ? <Pill tone="good">Promoted</Pill> : <Pill tone="warn">Not promoted</Pill>}
    >
      <KV
        rows={[
          ["Version", <span key="v" className="font-mono text-xs">{str(c.version)}</span>],
          ["Fitted", c.fitted_at ? `${fmtAgo(c.fitted_at)}${str(c.source_run, "") ? ` from experiment ${str(c.source_run).slice(0, 8)}` : ""}` : "–"],
          ["Checked answers", typeof c.n === "number" ? `${fmtInt(c.n)} (${fmtInt(c.n_pos ?? 0)} wrong, ${fmtInt(c.n_neg ?? 0)} right)` : "–"],
          ["Calibration error", `${fmtNum(c.ece, 3)}${typeof req.max_ece === "number" ? ` · target ${fmtNum(req.max_ece, 2)} or less` : ""}`],
          ["Brier score", fmtNum(c.brier, 3)],
          ["Needed to promote", typeof req.min_n === "number" ? `${fmtInt(req.min_n)} answers, ${fmtInt(req.min_per_class)} of each kind` : "–"],
          st.promoted !== true && str(st.promotion_reason, "") ? ["Why not promoted", str(st.promotion_reason)] : null,
        ]}
      />
    </Panel>
  );
}

function Caps({ system }: { system: Rec }) {
  const d = rec(system.deliberation);
  const params = rec(rec(rec(system.gate).state).params);
  const cfgCaps = rec(d.caps);
  const domains = [...new Set([...Object.keys(params), ...Object.keys(cfgCaps)])];
  return (
    <Panel
      title="Deliberation caps"
      info="How far System 2 may go per topic: N parallel attempts, R retries and a thinking budget, with the measured share of System 2 answers that are still wrong and the time it adds."
      bodyClassName="p-0"
    >
      {domains.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-2">
              <tr>
                {["Topic", "System 2 still wrong", "Extra time", "Attempts (N)", "Retries (R)", "Thinking budget", "Source"].map((h) => (
                  <th key={h} className={TH}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {domains.map((k) => {
                const p = rec(params[k]);
                const caps = Object.keys(rec(p.caps)).length ? rec(p.caps) : rec(cfgCaps[k]);
                const measured = [p.e2_source, p.delta_c_source, p.caps_source].filter((s) => s === "measured").length;
                return (
                  <tr key={k} className="border-t border-hairline">
                    <td className={cn(TD, "font-medium")}>{k}</td>
                    <td className={cn(TD, "tabular-nums")}>{fmtPct(p.e2_hat)}</td>
                    <td className={cn(TD, "tabular-nums")}>{typeof p.delta_c_s === "number" ? `${fmtNum(p.delta_c_s, 1)} s` : "–"}</td>
                    <td className={cn(TD, "tabular-nums")}>{fmtInt(caps.N)}</td>
                    <td className={cn(TD, "tabular-nums")}>{fmtInt(caps.R)}</td>
                    <td className={cn(TD, "tabular-nums")}>{typeof caps.budget === "number" ? `${fmtInt(caps.budget)} tokens` : "–"}</td>
                    <td className={TD}>{measured ? <Pill tone="good">measured</Pill> : p.e2_source ? <Pill>default</Pill> : <Pill>configured</Pill>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-4 text-sm text-ink-soft">No per-topic caps reported.</p>
      )}
      <KV
        className="border-t border-hairline px-4 py-3"
        rows={[
          ["System 2 sees the quick draft", yes(d.draft_blind === undefined ? undefined : !d.draft_blind, "Yes", "No (independent)")],
          ["Draft length", typeof d.draft_max_tokens === "number" ? `${fmtInt(d.draft_max_tokens)} tokens` : "–"],
          ["Answer length", typeof d.answer_max_tokens === "number" ? `${fmtInt(d.answer_max_tokens)} tokens` : "–"],
          ["Rounds on open questions", fmtInt(d.non_verifiable_max_rounds)],
          ["Most retries allowed", fmtInt(d.max_rounds_cap)],
          typeof d.retry_budget_decay === "number" ? ["Retry budget", `each retry gets ${fmtPct(d.retry_budget_decay)} of the last (at least ${fmtInt(d.retry_min_budget)} tokens)`] : null,
          str(d.caps_provenance, "") ? ["Where the caps come from", str(d.caps_provenance)] : null,
        ]}
      />
    </Panel>
  );
}

function Host({ system }: { system: Rec }) {
  const h = rec(system.host);
  const sec = rec(system.security);
  const srv = rec(system.server);
  const kb = rec(system.knowledge);
  return (
    <Panel title="Host and service">
      <KV
        rows={[
          ["Computer", `${str(h.os)}/${str(h.arch)} · ${fmtInt(h.cpus)} CPUs`],
          ["Running for", typeof system.uptime_s === "number" ? fmtMs(system.uptime_s * 1000) : "–"],
          ["Gateway version", str(system.version)],
          ["Profile", str(system.profile)],
          [
            "Security",
            Object.keys(sec).length
              ? `access key ${sec.auth_enabled ? "required" : "not required"} · ${sec.loopback_only ? "this computer only" : "open to the network"} · code sandbox ${sec.sandbox_isolation ? "on" : "off"} · chats kept ${fmtInt(sec.retention_days)} days`
              : "–",
          ],
          ["Limits", `${typeof srv.request_wall_clock_cap_s === "number" ? `${fmtInt(srv.request_wall_clock_cap_s)} s per answer` : "–"} · ${typeof srv.max_prompt_tokens === "number" ? `${fmtInt(srv.max_prompt_tokens)} prompt tokens` : "–"}`],
          ["Knowledge service", kb.enabled === true ? "On" : kb.enabled === false ? "Off" : "–"],
          ["Settings version", <span key="h" className="font-mono text-xs break-all">{str(system.config_hash)}</span>],
        ]}
      />
    </Panel>
  );
}

/** /duo/status: which models are running and healthy, the settings in force, and the latest answers. */
export function DuoStatus() {
  const sys = useGw<Rec>("/v1/system", { refreshMs: STATUS_REFRESH_MS });
  const health = useGw<Rec>("/healthz", { refreshMs: STATUS_REFRESH_MS });
  const system = rec(sys.data);
  const warnings = arr<string>(system.config_warnings).filter((w) => typeof w === "string" && w);
  const intro = (
    <PageIntro
      title="Is everything working?"
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void sys.reload();
            void health.reload();
          }}
          disabled={sys.loading}
        >
          {sys.loading && sys.data ? <Spinner className="size-3.5" /> : <RefreshCw />} Refresh
        </Button>
      }
    >
      Which models are running and healthy, the settings in force, and the latest answers. Refreshes by itself every {STATUS_REFRESH_MS / 1000} seconds.
    </PageIntro>
  );
  if (sys.loading && !sys.data)
    return (
      <div className="space-y-4">
        {intro}
        <Loading label="Checking the service…" />
      </div>
    );
  if (sys.error && !sys.data)
    return (
      <div className="space-y-4">
        {intro}
        <GwErrorState error={sys.error} onRetry={() => sys.reload(false)} what="the service status" />
      </div>
    );
  return (
    <div className="space-y-4 pb-8">
      {intro}
      {sys.error ? <Note tone="warn">Could not refresh: {sys.error.message}. Showing the last known state.</Note> : null}
      <Health health={health.data} system={system} />
      {warnings.length ? (
        <Note tone="warn">
          <strong>Configuration notes:</strong>
          <ul className="mt-1 list-disc pl-5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Note>
      ) : null}
      <Backends system={system} onChanged={() => void sys.reload()} />
      <div className="grid gap-4 lg:grid-cols-2">
        <GateSettings system={system} />
        <Calibration system={system} />
      </div>
      <Caps system={system} />
      <Activity />
      <Host system={system} />
    </div>
  );
}
