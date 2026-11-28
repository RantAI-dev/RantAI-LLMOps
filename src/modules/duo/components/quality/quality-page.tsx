"use client";

import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GwErrorState, Loading, PageIntro, Stat, StatGrid, arr, fmtInt, fmtPct, rec } from "@/modules/duo/components/duo-ui";
import { AuditsPanel } from "@/modules/duo/components/quality/audits-panel";
import { TryChecker, VerifierRatesPanel } from "@/modules/duo/components/quality/checks-panels";
import { CalibrationPanel, GateModePanel, LabelsPanel, ParamsPanel, type Gate } from "@/modules/duo/components/quality/gate-panels";
import { RoadmapPanel } from "@/modules/duo/components/quality/roadmap-panel";
import { num } from "@/modules/duo/components/quality/shared";
import { PreferencesPanel, SelfModelPanel } from "@/modules/duo/components/quality/topic-panels";
import { AlertsPanel, DriftPanel } from "@/modules/duo/components/quality/warnings-panels";
import { useGw } from "@/modules/duo/lib/gw";

type Obj = Record<string, unknown>;

/** The four plain numbers at the top: how much is answered, how often Auto thinks longer, how far the checks can be fooled, and warnings. */
export function qualitySummary(selfModel: Obj | null, rates: Obj | null, alerts: Obj | null) {
  const D = arr(selfModel?.domains);
  const total = D.reduce((a, d) => a + (num(d.n) ?? 0), 0);
  const escalated = total ? D.reduce((a, d) => a + (num(d.n) ?? 0) * (num(d.escalation_rate) ?? 0), 0) / total : null;
  const measured = D.filter((d) => d.status === "measured").length;
  const exact = Object.entries(rec(rates?.rates)).filter(([k]) => k !== "judge");
  const worst = exact.length ? exact.reduce((m, [, v]) => Math.max(m, num(rec(v).phi_upper95) ?? 0), 0) : null;
  const firing = alerts ? arr(alerts.rules).filter((r) => r.state === "firing").length : null;
  return { total: selfModel ? total : null, escalated, measured, worst, firing };
}

export function QualityPage() {
  const gate = useGw<Gate>("/v1/gate", { refreshMs: 20_000 });
  const selfModel = useGw<Obj>("/v1/self-model", { refreshMs: 30_000 });
  const alerts = useGw<Obj>("/v1/alerts", { refreshMs: 20_000 });
  const rates = useGw<Obj>("/v1/verifiers", { refreshMs: 60_000 });
  const labels = useGw<Obj>("/v1/gate/labels", { refreshMs: 60_000 });

  const s = qualitySummary(selfModel.data, rates.data, alerts.data);
  const reloadAll = () => {
    void gate.reload();
    void selfModel.reload();
    void alerts.reload();
    void rates.reload();
    void labels.reload();
  };

  return (
    <div className="space-y-4 pb-6">
      <PageIntro
        title="How reliable are the answers?"
        actions={
          <Button size="sm" variant="outline" onClick={reloadAll}>
            <RefreshCw /> Refresh
          </Button>
        }
      >
        How Auto decides when to think longer, how trustworthy the checks are, how often answers are right per topic, and early warnings when quality slips. Numbers come
        from real use and spot checks; experiments are kept apart.
      </PageIntro>

      <StatGrid>
        <Stat label="Answers so far" value={fmtInt(s.total)} hint="from real use" />
        <Stat label="Thought longer" value={fmtPct(s.escalated)} hint="of answers took the thorough path" />
        <Stat
          label="Exact checks fooled"
          value={s.worst === null ? "–" : `≤ ${fmtPct(s.worst, 1)}`}
          hint={s.worst === null ? "not measured yet" : "worst case, 95% bound"}
          tone={s.worst !== null && s.worst > 0.01 ? "warn" : undefined}
        />
        <Stat
          label="Warnings"
          value={s.firing === null ? "–" : fmtInt(s.firing)}
          hint={s.firing ? "see the Warnings tab" : `${s.measured} topic${s.measured === 1 ? "" : "s"} fully measured`}
          tone={s.firing ? "bad" : s.firing === 0 ? "good" : undefined}
        />
      </StatGrid>

      <Tabs defaultValue="auto">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1 rounded-lg border border-hairline bg-surface p-1">
          <TabsTrigger value="auto">How Auto decides</TabsTrigger>
          <TabsTrigger value="topics">By topic</TabsTrigger>
          <TabsTrigger value="checks">Checks</TabsTrigger>
          <TabsTrigger value="warnings">
            Warnings
            {s.firing ? (
              <span className="ml-1 rounded-full bg-danger-soft px-1.5 text-[10px] font-semibold text-danger" aria-label={`${s.firing} firing`}>
                {s.firing}
              </span>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="spot">Spot checks</TabsTrigger>
          <TabsTrigger value="release">Release readiness</TabsTrigger>
        </TabsList>

        <TabsContent value="auto" className="mt-3 space-y-3">
          {gate.error && !gate.data ? (
            <GwErrorState error={gate.error} onRetry={() => gate.reload(false)} what="how Auto decides" />
          ) : !gate.data ? (
            <Loading />
          ) : (
            <>
              <div className="grid gap-3 lg:grid-cols-2">
                <GateModePanel gate={gate.data} labels={labels.data} onGate={(g) => gate.setData(g)} />
                <CalibrationPanel gate={gate.data} />
              </div>
              <ParamsPanel gate={gate.data} onChanged={() => void gate.reload()} />
              <LabelsPanel labels={labels.data} error={labels.error} onRetry={() => labels.reload(false)} />
            </>
          )}
        </TabsContent>

        <TabsContent value="topics" className="mt-3 space-y-3">
          <SelfModelPanel data={selfModel.data} error={selfModel.error} onRetry={() => selfModel.reload(false)} />
          <PreferencesPanel />
        </TabsContent>

        <TabsContent value="checks" className="mt-3 space-y-3">
          <VerifierRatesPanel rates={rates.data} ratesError={rates.error} onRates={() => void rates.reload()} />
          <TryChecker />
        </TabsContent>

        <TabsContent value="warnings" className="mt-3 space-y-3">
          <AlertsPanel data={alerts.data} error={alerts.error} onRetry={() => alerts.reload(false)} onChanged={(a) => alerts.setData(a)} />
          <DriftPanel />
        </TabsContent>

        <TabsContent value="spot" className="mt-3 space-y-3">
          <AuditsPanel />
        </TabsContent>

        <TabsContent value="release" className="mt-3 space-y-3">
          <RoadmapPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
