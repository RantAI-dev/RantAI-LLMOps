"use client";

import { RotateCcw, SlidersHorizontal, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  GwErrorState,
  KV,
  Loading,
  Meter,
  Note,
  Panel,
  Pill,
  Segmented,
  Spinner,
  Stat,
  arr,
  fmtAgo,
  fmtInt,
  fmtNum,
  fmtPct,
  rec,
  str,
} from "@/modules/duo/components/duo-ui";
import {
  ConfirmDialog,
  Fold,
  MODE_HINT,
  MODE_NAME,
  ReliabilityChart,
  SourcePill,
  TableWrap,
  Th,
  domainName,
  num,
  plain,
  tableCls,
  tdCls,
  theadCls,
  trCls,
} from "@/modules/duo/components/quality/shared";
import { GwError, gw, useGw } from "@/modules/duo/lib/gw";

export type Gate = Record<string, unknown>;
const MODES = ["fixed", "calibrated", "budget"] as const;
type Mode = (typeof MODES)[number];

const errMsg = (e: unknown) =>
  e instanceof GwError ? e.message : e instanceof Error ? e.message : String(e);

// ---------------------------------------------------------------------------------------------------
// How Auto decides: mode, fixed share, relearning
// ---------------------------------------------------------------------------------------------------
export function GateModePanel({
  gate,
  labels,
  onGate,
}: {
  gate: Gate;
  labels: Record<string, unknown> | null;
  onGate: (g: Gate) => void;
}) {
  const mode = str(gate.mode, "fixed");
  const eff = str(gate.effective_rule, "fixed");
  const req = rec(gate.requirements);
  const budget = num(gate.escalation_budget) ?? 0.3;
  const [pendingMode, setPendingMode] = useState<Mode | null>(null);
  const [share, setShare] = useState<number | null>(null);
  const [confirmShare, setConfirmShare] = useState(false);
  const [confirmRecal, setConfirmRecal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recal, setRecal] = useState<Record<string, unknown> | null>(null);
  const shown = share ?? budget;

  async function post(body: Record<string, unknown>, ok: string) {
    setBusy(true);
    try {
      const g = await gw<Gate>("/v1/gate", { method: "POST", body });
      onGate(rec(g));
      toast.success(ok);
      return true;
    } catch (e) {
      toast.error("Nothing was changed", { description: errMsg(e) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function relearn() {
    setBusy(true);
    try {
      const r = await gw<Record<string, unknown>>("/v1/gate/recalibrate", {
        method: "POST",
        body: {},
      });
      setConfirmRecal(false);
      setRecal(rec(r));
      // The gate view now carries the new calibration (or the candidate was kept aside).
      gw<Gate>("/v1/gate").then(
        (g) => onGate(rec(g)),
        () => undefined,
      );
    } catch (e) {
      toast.error("Relearning did not run", { description: errMsg(e) });
    } finally {
      setBusy(false);
    }
  }

  const ledger = rec(labels?.ledger);
  const labelled = num(ledger.labelled);
  const minN = num(req.min_n) ?? 2900;

  return (
    <Panel
      title="How Auto decides"
      info="Auto lets the quick model (System 1) answer and decides from its draft whether the thorough model (System 2) should take over. This is that decision rule, called the gate."
      actions={
        <Pill tone={eff === "fixed" ? "info" : "good"}>
          in use: {MODE_NAME[eff] ?? eff}
        </Pill>
      }
    >
      <div className="space-y-3">
        <Segmented<Mode>
          label="Rule Auto uses"
          value={
            (MODES as readonly string[]).includes(mode)
              ? (mode as Mode)
              : "fixed"
          }
          onChange={(m) => m !== mode && setPendingMode(m)}
          options={MODES.map((m) => ({
            id: m,
            label: MODE_NAME[m],
            hint: MODE_HINT[m],
          }))}
        />
        {mode === "budget" ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label htmlFor="gate-share" className="text-ink-soft">
              Share sent to thorough
            </label>
            <input
              id="gate-share"
              type="range"
              min={0.05}
              max={0.9}
              step={0.05}
              value={shown}
              onChange={(e) => setShare(Number(e.target.value))}
              className="w-40 accent-[var(--primary)]"
              aria-valuetext={fmtPct(shown)}
            />
            <span className="w-10 font-mono text-xs tabular-nums">
              {fmtPct(shown)}
            </span>
            {share !== null && Math.abs(share - budget) > 1e-6 ? (
              <>
                <Button
                  size="xs"
                  onClick={() => setConfirmShare(true)}
                  disabled={busy}
                >
                  Apply
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => setShare(null)}
                  disabled={busy}
                >
                  Reset
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
        <KV
          className="text-[13px]"
          rows={[
            ["Rule in use", MODE_HINT[eff] ?? "–"],
            [
              "Learned rule",
              gate.promoted === true ? (
                <Pill tone="good">accurate enough to use</Pill>
              ) : (
                <span className="space-x-1.5">
                  <Pill tone="warn">not in use yet</Pill>
                  {gate.promotion_reason ? (
                    <span className="text-xs text-ink-soft">
                      {plain(gate.promotion_reason)}
                    </span>
                  ) : null}
                </span>
              ),
            ],
            [
              "Fixed share",
              <span key="fs" className="text-xs text-ink-soft">
                Needs the learned rule, trained on at least {fmtInt(req.dkw_n)}{" "}
                checked answers, so the share holds within ±
                {fmtPct(req.epsilon, 1)} (
                {fmtPct(typeof req.delta === "number" ? 1 - req.delta : null)}{" "}
                confidence).
              </span>,
            ],
            [
              "Practice while idle",
              labels === null ? (
                "–"
              ) : labels.enabled === true ? (
                <span className="space-y-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Pill tone="good">on</Pill>
                    <span className="text-xs text-ink-soft">
                      {fmtInt(labelled)} checked quick answers,{" "}
                      {fmtPct(
                        labelled !== null ? Math.min(1, labelled / minN) : null,
                      )}{" "}
                      of the {fmtInt(minN)} the learned rule needs
                    </span>
                  </span>
                  <Meter
                    value={labelled !== null ? labelled / minN : 0}
                    label="Checked answers collected for the learned rule"
                  />
                </span>
              ) : (
                <span className="space-x-1.5">
                  <Pill>off</Pill>
                  <span className="text-xs text-ink-soft">
                    Switch it on in the gateway settings to collect checked
                    answers while nobody is using it.
                  </span>
                </span>
              ),
            ],
            [
              "Relearning",
              <span key="rl" className="flex flex-wrap items-center gap-2">
                <span>
                  {num(gate.recalibrate_every_h)
                    ? `every ${gate.recalibrate_every_h} h from real use`
                    : "by hand"}
                </span>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => setConfirmRecal(true)}
                  disabled={busy}
                >
                  <RotateCcw /> Relearn now
                </Button>
              </span>,
            ],
          ]}
        />
        {mode !== eff ? (
          <Note tone="info">
            <strong>{MODE_NAME[mode] ?? mode}</strong> is selected, but the
            simple rule stays in use until the learned rule is accurate enough.
          </Note>
        ) : null}
      </div>

      <ConfirmDialog
        open={pendingMode !== null}
        title={`Switch Auto to “${pendingMode ? MODE_NAME[pendingMode] : ""}”?`}
        confirmLabel="Switch"
        busy={busy}
        onClose={() => setPendingMode(null)}
        onConfirm={async () => {
          if (
            pendingMode &&
            (await post(
              { mode: pendingMode },
              `Auto now uses: ${MODE_NAME[pendingMode]}`,
            ))
          )
            setPendingMode(null);
        }}
      >
        <p>{pendingMode ? MODE_HINT[pendingMode] : null}</p>
        <p className="mt-2">
          This changes at once how Auto decides when to think longer, for
          everyone using this service. You can switch back here at any time.
        </p>
        {pendingMode && pendingMode !== "fixed" && gate.promoted !== true ? (
          <p className="mt-2">
            The learned rule is not accurate enough yet, so the simple rule
            keeps deciding until it is.
          </p>
        ) : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmShare}
        title={`Send ${fmtPct(shown)} of questions to the thorough model?`}
        confirmLabel="Apply"
        busy={busy}
        onClose={() => setConfirmShare(false)}
        onConfirm={async () => {
          if (
            await post(
              { escalation_budget: shown },
              `Share sent to thorough: ${fmtPct(shown)}`,
            )
          ) {
            setConfirmShare(false);
            setShare(null);
          }
        }}
      >
        <p>
          A larger share gives more careful answers but makes answers slower on
          average and uses more of the reasoning model. It applies at once, for
          everyone.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmRecal}
        title="Relearn the mistake prediction now?"
        confirmLabel="Relearn"
        busy={busy}
        onClose={() => setConfirmRecal(false)}
        onConfirm={relearn}
      >
        <p>
          Auto refits its prediction of when the quick answer is wrong, from
          every quick answer whose correctness is known. The new prediction is
          used only if it is accurate enough; otherwise the current one stays
          and the new one is kept aside. This can take a few seconds.
        </p>
      </ConfirmDialog>
      <RecalibrationResult result={recal} onClose={() => setRecal(null)} />
    </Panel>
  );
}

function RecalibrationResult({
  result,
  onClose,
}: {
  result: Record<string, unknown> | null;
  onClose: () => void;
}) {
  const k = rec(result?.calibration);
  const req = rec(result?.requirements);
  const names = arr<string>(k.feature_names);
  const weights = arr<number>(k.weights);
  return (
    <Dialog open={result !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-primary">
            {result?.promoted === true
              ? "New prediction in use"
              : "New prediction not used"}
          </DialogTitle>
          <DialogDescription>{plain(result?.note)}</DialogDescription>
        </DialogHeader>
        {result?.reason ? (
          <Note tone="warn">{plain(result.reason)}</Note>
        ) : null}
        <KV
          className="text-[13px]"
          rows={[
            [
              "Version",
              <span key="v" className="font-mono text-xs">
                {str(k.version)}
              </span>,
            ],
            [
              "Checked quick answers",
              `${fmtInt(k.n)} (${fmtInt(k.n_pos)} wrong, ${fmtInt(k.n_neg)} right) · needs ${fmtInt(req.min_n)} or more, with at least ${fmtInt(req.min_per_class)} of each`,
            ],
            [
              "Calibration error",
              `${fmtNum(k.ece, 3)} on held-out questions · target ${fmtNum(req.max_ece, 2)} or less`,
            ],
            ["Brier score", fmtNum(k.brier, 3)],
            [
              "In use",
              result?.active === true
                ? "yes"
                : "no: the previous setting stays in force",
            ],
            names.length
              ? [
                  "Signal weights",
                  <span key="w" className="font-mono text-[11px]">
                    {names.map((n, j) => (
                      <span key={n} className="block">
                        {n}: {fmtNum(weights[j], 3)}
                      </span>
                    ))}
                  </span>,
                ]
              : null,
          ]}
        />
        {arr(k.reliability).length ? (
          <ReliabilityChart
            points={arr<[number, number, number]>(k.reliability)}
          />
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------------
// How well Auto predicts mistakes (calibration)
// ---------------------------------------------------------------------------------------------------
export function CalibrationPanel({ gate }: { gate: Gate }) {
  const cal = rec(gate.calibration);
  const req = rec(gate.requirements);
  const version = str(cal.version, "");
  const prior = !version || /^prior/.test(version);
  const n = num(cal.n) ?? 0;
  const ece = num(cal.ece);
  const maxEce = num(req.max_ece);
  return (
    <Panel
      title="How well Auto predicts mistakes"
      info="Before deciding, Auto estimates the chance that the quick answer is wrong (technical name: e1_hat). A good estimate means the dots below sit on the diagonal."
      actions={
        <Pill title={version || undefined}>
          {prior ? "starting estimate" : `learned ${fmtAgo(cal.fitted_at)}`}
        </Pill>
      }
    >
      {n > 0 ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <Stat
              label="Calibration error"
              value={fmtNum(ece, 3)}
              hint={`target ${fmtNum(maxEce, 2)} or less`}
              tone={
                ece !== null && maxEce !== null
                  ? ece <= maxEce
                    ? "good"
                    : "warn"
                  : undefined
              }
            />
            <Stat
              label="Checked answers"
              value={fmtInt(n)}
              hint={`needs ${fmtInt(req.min_n)}`}
            />
            <Stat
              label="Wrong / right"
              value={`${fmtInt(cal.n_pos)} / ${fmtInt(cal.n_neg)}`}
              hint={`at least ${fmtInt(req.min_per_class)} of each`}
            />
          </div>
          {arr(cal.reliability).length ? (
            <div className="flex justify-center">
              <ReliabilityChart
                points={arr<[number, number, number]>(cal.reliability)}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-ink-soft">
          Not learned yet: Auto uses a starting estimate. It learns from quick
          answers whose correctness is known (checked questions, spot checks and
          experiments). Press <strong>Relearn now</strong>, or tune it from
          experiments.
        </p>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------------
// The label stream: checked quick answers collected while idle
// ---------------------------------------------------------------------------------------------------
export function LabelsPanel({
  labels,
  error,
  onRetry,
}: {
  labels: Record<string, unknown> | null;
  error: GwError | null;
  onRetry: () => void;
}) {
  if (error && !labels)
    return (
      <GwErrorState
        error={error}
        onRetry={onRetry}
        what="the practice stream"
      />
    );
  if (!labels) return <Loading />;
  const ledger = rec(labels.ledger);
  const labelled = num(ledger.labelled) ?? 0;
  const wrong = num(ledger.draft_wrong);
  return (
    <Fold
      title="Practice while idle"
      summary={
        labels.enabled === true
          ? `on · ${fmtInt(labelled)} checked quick answers collected`
          : "off"
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink-soft">
          While nobody is using the service, the quick model answers practice
          questions whose correct answer is known. Each one teaches Auto when
          the quick answer can be trusted.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="Collected"
            value={fmtInt(labelled)}
            hint={
              wrong !== null && labelled
                ? `${fmtPct(wrong / labelled)} were wrong`
                : undefined
            }
          />
          <Stat
            label="Answered since start"
            value={fmtInt(labels.answered_since_start)}
          />
          <Stat
            label="Paused for real users"
            value={fmtInt(labels.yielded_to_users)}
          />
          <Stat
            label="Errors"
            value={fmtInt(labels.errors)}
            tone={num(labels.errors) ? "warn" : undefined}
          />
        </div>
        <KV
          className="text-[13px]"
          rows={[
            [
              "Status",
              labels.enabled === true ? (
                <Pill tone="good">on</Pill>
              ) : (
                <Pill>off</Pill>
              ),
            ],
            ["Practice set", str(labels.dataset)],
            [
              "Pace",
              num(labels.per_hour)
                ? `up to ${fmtInt(labels.per_hour)} per hour`
                : "–",
            ],
            [
              "Position",
              num(labels.tasks)
                ? `${fmtInt(labels.position)} of ${fmtInt(labels.tasks)} questions`
                : fmtInt(labels.position),
            ],
            labels.last_error
              ? [
                  "Last error",
                  <span key="e" className="text-danger">
                    {str(labels.last_error)}
                  </span>,
                ]
              : null,
          ]}
        />
      </div>
    </Fold>
  );
}

// ---------------------------------------------------------------------------------------------------
// Settings per topic (measured or default), tune from experiments, back to defaults
// ---------------------------------------------------------------------------------------------------
export function ParamsPanel({
  gate,
  onChanged,
}: {
  gate: Gate;
  onChanged: () => void;
}) {
  const prov = rec(gate.params);
  const derived = rec(gate.derived);
  const doms = Object.keys(prov);
  const tuned = typeof derived.derived_at === "string" && derived.derived_at;
  const [confirmReset, setConfirmReset] = useState(false);
  const [deriveOpen, setDeriveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Fold
        title="Settings per topic"
        summary={
          tuned
            ? `Tuned ${fmtAgo(derived.derived_at)} from ${arr(derived.source_runs).length} experiment(s)`
            : "Defaults until tuned from experiments"
        }
        actions={
          <>
            <Button
              size="xs"
              variant="outline"
              onClick={() => setDeriveOpen(true)}
            >
              <SlidersHorizontal /> Tune from experiments
            </Button>
            {tuned ? (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setConfirmReset(true)}
              >
                Back to defaults
              </Button>
            ) : null}
          </>
        }
      >
        {doms.length ? (
          <TableWrap>
            <table className={tableCls}>
              <thead className={theadCls}>
                <tr>
                  <Th>Topic</Th>
                  <Th tip="Expected share of thorough answers that are still wrong (e2_hat).">
                    Thorough still wrong
                  </Th>
                  <Th tip="How much longer a thorough answer takes than a quick one (delta_c).">
                    Extra time
                  </Th>
                  <Th tip="Thorough attempts per question (N).">Attempts</Th>
                  <Th tip="Retries after a failed check (R).">Retries</Th>
                  <Th tip="Thinking tokens allowed for a thorough answer.">
                    Thinking budget
                  </Th>
                  <Th>Source</Th>
                </tr>
              </thead>
              <tbody>
                {doms.map((d) => {
                  const x = rec(prov[d]);
                  const caps = rec(x.caps);
                  return (
                    <tr key={d} className={trCls}>
                      <td className={tdCls}>{domainName(d)}</td>
                      <td className={tdCls}>
                        {fmtPct(x.e2_hat, 1)}{" "}
                        <SourcePill source={x.e2_source} />
                      </td>
                      <td className={tdCls}>
                        {num(x.delta_c_s) !== null
                          ? `${fmtNum(x.delta_c_s)} s`
                          : "–"}{" "}
                        <SourcePill source={x.delta_c_source} />
                      </td>
                      <td className={tdCls}>{fmtInt(caps.N)}</td>
                      <td className={tdCls}>{fmtInt(caps.R)}</td>
                      <td className={tdCls}>{fmtInt(caps.budget)}</td>
                      <td className={tdCls}>
                        <span className="inline-flex flex-wrap gap-1">
                          <SourcePill source={x.caps_source} />
                          <SourcePill source={x.budget_source} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <p className="text-sm text-ink-soft">
            No per-topic settings reported.
          </p>
        )}
        <p className="mt-2 text-xs text-ink-soft">
          To tune them, run <em>System 1 only</em> and <em>System 2 always</em>{" "}
          on the same questions on the Experiments page, then choose Tune from
          experiments.
        </p>
      </Fold>
      <ConfirmDialog
        open={confirmReset}
        title="Go back to the default settings?"
        confirmLabel="Use defaults"
        busy={busy}
        onClose={() => setConfirmReset(false)}
        onConfirm={async () => {
          setBusy(true);
          try {
            await gw("/v1/gate/params", { method: "DELETE" });
            toast.success("Default settings are in use again");
            setConfirmReset(false);
            onChanged();
          } catch (e) {
            toast.error("The settings were not changed", {
              description: errMsg(e),
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          The measured values are discarded and Auto goes back to the default
          values for every topic. You can tune them again from experiments.
        </p>
      </ConfirmDialog>
      {deriveOpen ? (
        <DeriveDialog
          onClose={() => setDeriveOpen(false)}
          onApplied={() => {
            setDeriveOpen(false);
            onChanged();
          }}
        />
      ) : null}
    </>
  );
}

/** Pick finished experiments, preview the measured settings, then apply them. */
export function DeriveDialog({
  onClose,
  onApplied,
}: {
  onClose: () => void;
  onApplied: () => void;
}) {
  const runs = useGw<unknown[]>("/v1/eval/runs");
  const [picked, setPicked] = useState<string[]>([]);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = arr(runs.data).filter(
    (r) => r.status !== "running" && typeof r.run_id === "string",
  );

  async function call(apply: boolean) {
    setBusy(apply ? "apply" : "preview");
    setError(null);
    try {
      const r = await gw<Record<string, unknown>>("/v1/gate/derive", {
        method: "POST",
        body: { run_ids: picked, apply, min_n: 10 },
      });
      if (apply) {
        toast.success("Tuned settings applied");
        onApplied();
      } else setPreview(rec(r));
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const p = rec(preview?.params);
  const det = rec(p.details);
  const budgets = rec(p.budgets);
  const rows = Object.entries(det).filter(([d]) => d !== "budget_curve");
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-primary">
            Tune settings from experiments
          </DialogTitle>
          <DialogDescription>
            Pick experiments that ran <em>System 1 only</em> and{" "}
            <em>System 2 always</em> on the same questions. Nothing changes
            until you apply the preview.
          </DialogDescription>
        </DialogHeader>
        {runs.error ? (
          <GwErrorState
            error={runs.error}
            onRetry={() => runs.reload(false)}
            what="the experiments"
          />
        ) : runs.loading && !runs.data ? (
          <Loading />
        ) : done.length === 0 ? (
          <Note>
            No finished experiments yet. Run one on the Experiments page first.
          </Note>
        ) : (
          <fieldset className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-hairline p-2">
            <legend className="sr-only">Experiments</legend>
            {done.map((r) => {
              const id = String(r.run_id);
              const q = rec(r.request);
              return (
                <label
                  key={id}
                  className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-surface-2"
                >
                  <input
                    type="checkbox"
                    checked={picked.includes(id)}
                    onChange={(e) => {
                      setPreview(null);
                      setPicked((cur) =>
                        e.target.checked
                          ? [...cur, id]
                          : cur.filter((x) => x !== id),
                      );
                    }}
                  />
                  <span className="font-medium">
                    {str(q.benchmark, "experiment")}
                  </span>
                  <span className="text-xs text-ink-soft">
                    {arr<string>(q.systems).join(", ")}
                  </span>
                  <span className="ml-auto text-xs text-ink-faint">
                    {fmtAgo(r.created_at)}
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        {error ? <Note tone="bad">{error}</Note> : null}
        {preview ? (
          <div className="space-y-2">
            <p className="text-xs text-ink-soft">
              Topics with fewer than 10 thorough-only answers keep their
              defaults. Applying keeps a record of where the values came from.
            </p>
            <TableWrap>
              <table className={tableCls}>
                <thead className={theadCls}>
                  <tr>
                    <Th>Topic</Th>
                    <Th>Thorough / quick answers</Th>
                    <Th>Thorough still wrong</Th>
                    <Th>Extra time</Th>
                    <Th>Retries</Th>
                    <Th>Thinking budget</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([d, v]) => {
                    const x = rec(v);
                    const e2 = rec(x.e2_hat);
                    const dc = rec(x.delta_c_s);
                    const bf = rec(x.beta_fit);
                    return (
                      <tr key={d} className={trCls}>
                        <td className={tdCls}>{domainName(d)}</td>
                        <td className={tdCls}>
                          {fmtInt(x.n_slow ?? 0)} / {fmtInt(x.n_fast ?? 0)}
                        </td>
                        <td className={tdCls}>
                          {num(e2.value) !== null ? (
                            <>
                              <strong>{fmtPct(e2.value, 1)}</strong>{" "}
                              <span className="text-ink-faint">
                                ({fmtInt(e2.wrong)}/{fmtInt(e2.n)})
                              </span>
                            </>
                          ) : (
                            <span className="text-ink-faint">default</span>
                          )}
                        </td>
                        <td className={tdCls}>
                          {num(dc.value) !== null ? (
                            `${fmtNum(dc.value)} s`
                          ) : (
                            <span className="text-ink-faint">default</span>
                          )}
                        </td>
                        <td className={tdCls}>
                          {num(bf.R) !== null ? `up to ${bf.R}` : "–"}
                        </td>
                        <td className={tdCls}>{fmtInt(budgets[d])}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy !== null}>
            Cancel
          </Button>
          {preview ? (
            <Button onClick={() => call(true)} disabled={busy !== null}>
              {busy === "apply" ? <Spinner className="size-3.5" /> : null}
              Apply these values
            </Button>
          ) : (
            <Button
              onClick={() => call(false)}
              disabled={busy !== null || picked.length === 0}
            >
              {busy === "preview" ? (
                <Spinner className="size-3.5" />
              ) : (
                <Sparkles />
              )}
              Preview
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
