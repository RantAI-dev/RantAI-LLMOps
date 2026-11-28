"use client";

import { Sigma } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KV, Note, Pill, Spinner, arr, fmtInt, fmtNum, rec, str } from "@/modules/duo/components/duo-ui";
import { Reliability, toReliability } from "@/modules/duo/components/experiments/reliability";
import { gw } from "@/modules/duo/lib/gw";

type Result = Record<string, unknown>;

function Outcome({ r }: { r: Result }) {
  const k = rec(r.calibration);
  const req = rec(r.requirements);
  const names = arr<string>(k.feature_names);
  const weights = arr<number>(k.weights);
  const promoted = r.promoted === true;
  const bins = toReliability(k.reliability ?? k.risk_bins);
  return (
    <div className="space-y-3">
      <Note tone={promoted ? "good" : "warn"}>
        <strong>{promoted ? "Promoted: the gate now uses this prediction." : "Not promoted: the current setting stays in force."}</strong>{" "}
        {promoted
          ? "It was accurate enough on questions it had not seen, with enough answers of both kinds."
          : "The fit is saved as a candidate, so it can be promoted later once there is more evidence."}
        {str(r.reason, "") ? <span className="mt-1 block text-xs">Why: {str(r.reason)}</span> : null}
      </Note>
      <KV
        rows={[
          ["Version", <span key="v" className="font-mono text-xs">{str(k.version)}</span>],
          ["Checked quick answers", `${fmtInt(k.n)} (${fmtInt(k.n_pos)} wrong, ${fmtInt(k.n_neg)} right) · needs ${fmtInt(req.min_n)} or more, with at least ${fmtInt(req.min_per_class)} of each`],
          ["Calibration error", `${fmtNum(k.ece, 3)} on held-out questions · target ${fmtNum(req.max_ece, 2)} or less`],
          ["Brier score", fmtNum(k.brier, 3)],
          ["In use", r.active === true ? "Yes" : promoted ? "Promoted, but the gate is on the simple rule, so it is not consulted yet" : "No"],
          names.length
            ? [
                "Signal weights",
                <span key="w" className="font-mono text-xs">
                  {names.map((n, j) => `${n}: ${fmtNum(weights[j], 3)}`).join(" · ")}
                </span>,
              ]
            : null,
        ]}
      />
      {bins.length ? <Reliability points={bins} /> : null}
    </div>
  );
}

/**
 * "Fit from this experiment": learns how likely a System 1 answer is to be wrong from the run's checked answers. The
 * gateway promotes the fit (the gate starts using it) only if it passes its accuracy and sample-size bar.
 */
export function CalibrateButton({ runId, disabled }: { runId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fit() {
    setBusy(true);
    setError(null);
    try {
      setResult(rec(await gw(`/v1/eval/runs/${encodeURIComponent(runId)}/calibrate`, { method: "POST", body: { include_ledger: false } })));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => {
          setResult(null);
          setError(null);
          setOpen(true);
        }}
        title="Fit the gate's mistake prediction from this experiment's checked answers"
      >
        <Sigma /> Calibrate from this run
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{result ? (result.promoted === true ? "New prediction in use" : "New prediction not used") : "Calibrate the gate from this run"}</DialogTitle>
            {!result ? (
              <DialogDescription>
                The gate decides whether System 2 should take over by predicting how likely System 1&apos;s draft is to be wrong. Calibrating
                refits that prediction from this run&apos;s checked System 1 answers.
              </DialogDescription>
            ) : null}
          </DialogHeader>
          {result ? (
            <Outcome r={result} />
          ) : (
            <div className="space-y-2 text-sm text-ink-soft">
              <p>
                <strong className="text-foreground">What promotion means.</strong> The new fit is <em>promoted</em>, and the gate starts using it, only
                if it is accurate on questions it was not fitted on (a small calibration error) and is built from enough checked answers, both right and
                wrong. Otherwise it is kept as a candidate and nothing changes.
              </p>
              <p>
                Answers in progress are not affected. <Pill tone="info">Safe to try</Pill>
              </p>
              {error ? <Note tone="bad">{error}</Note> : null}
            </div>
          )}
          <DialogFooter>
            {result ? (
              <Button variant="outline" onClick={() => setOpen(false)}>
                Close
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button onClick={fit} disabled={busy}>
                  {busy ? <Spinner className="text-primary-foreground" /> : null}
                  {busy ? "Fitting…" : "Fit now"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
