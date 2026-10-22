/**
 * The decision trainer prints one summary line when it finishes:
 *
 *   DECISION_REPORT {"before": {...}, "after": {...}, "test_set": "eval.jsonl"}
 *
 * (trainers/unsloth-decision-train/train.py). Reading it from the job output needs no extra API, and
 * it deliberately has no `loss` key so it cannot be mistaken for a training-loss point by parseLoss.
 */
export type DecisionMetrics = { accuracy?: number; ece?: number; record_accuracy?: number };
export type DecisionSummary = { before: DecisionMetrics; after: DecisionMetrics; testSet: string };

const pick = (m: unknown): DecisionMetrics => {
  const o = (typeof m === "object" && m !== null ? m : {}) as Record<string, unknown>;
  const out: DecisionMetrics = {};
  for (const k of ["accuracy", "ece", "record_accuracy"] as const) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
};

/** The LAST report line in `output`, or null when the job has not printed one (yet, or it failed). */
export function parseDecisionReport(output: string): DecisionSummary | null {
  const lines = output.split(/\r|\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const at = lines[i]!.indexOf("DECISION_REPORT ");
    if (at < 0) continue;
    try {
      const raw = JSON.parse(lines[i]!.slice(at + "DECISION_REPORT ".length)) as Record<string, unknown>;
      return {
        before: pick(raw.before),
        after: pick(raw.after),
        testSet: typeof raw.test_set === "string" ? raw.test_set : "holdout",
      };
    } catch {
      return null;
    }
  }
  return null;
}
