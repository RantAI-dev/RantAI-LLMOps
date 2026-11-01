/**
 * Scoring for a DECISION-MODEL (System One) eval.
 *
 * A decision model does not write text: for each typed question (`noul` yes/no, `choice`, `score`) it
 * returns a probability for every option. So it is judged on two things, not one:
 *
 *  - Is the answer RIGHT?      accuracy; for `choice` Macro-F1 + a confusion matrix; for `score` how far
 *                              off the level is (MAE, "within one level").
 *  - Is it HONEST about being right? calibration: when it says 80%, is it right 80% of the time?
 *                              ECE, Brier score, log loss, and a reliability diagram.
 *
 * The second is what makes the model usable: a calibrated confidence lets a team automate the
 * decisions the model is sure about and send the rest to a person. `automation` answers "if only
 * decisions at or above X% confidence are automated, how many is that, and how accurate?".
 *
 * Deterministic, no LLM judge: every number is a pure function of the stored probabilities, so a run
 * can be re-scored for free. Test rows are the same shape as training rows (`{state, questions, gold}`).
 */
import { normalizeDecisionRow, optionsOf, validateDecisionRow } from "@/lib/decision-schema";

export type QuestionType = "noul" | "choice" | "score";

/** What the eval knows about one question name, taken from the test rows. */
export type QuestionMeta = { type: QuestionType; options: string[] };

export type EvalRow = {
  state: unknown;
  questions: Record<string, { type: QuestionType; criteria?: unknown; instructions?: unknown }>;
  gold: Record<string, unknown>;
};

export type DecisionPrediction = {
  label: string;
  /** Probability of every option (sums to ~1). */
  probs: Record<string, number>;
  /** `score` questions: the expected level (a decimal), as the server reports it. */
  score?: number;
};

export type DecisionResult = {
  gold: string;
  pred: string;
  /** Probability the model gave to the label it chose. */
  conf: number;
  /** Probability the model gave to the correct label. */
  pGold: number;
  probs: Record<string, number>;
  correct: boolean;
};

/** One test row scored against the model's answer. */
export type DecisionCase = {
  i: number;
  /** The state, shortened for the case table. */
  state: string;
  results: Record<string, DecisionResult>;
  /** Labelled questions the model gave no usable answer for: the row cannot count as fully right. */
  unanswered?: number;
  /** The request failed: the row is not scored and is counted in `errorCount`. */
  error?: string;
};

export type ClassStat = { precision: number; recall: number; f1: number; support: number };

export type QuestionReport = {
  name: string;
  type: QuestionType;
  options: string[];
  /** Decisions scored for this question. */
  n: number;
  accuracy: number;
  meanConfidence: number;
  ece: number;
  brier: number;
  logLoss: number;
  /** `choice` and `noul`. */
  macroF1?: number;
  perClass?: Record<string, ClassStat>;
  /** gold label -> predicted label -> count. */
  confusion?: Record<string, Record<string, number>>;
  /** `score`: mean absolute error in levels, and the share within one level of the truth. */
  mae?: number;
  within1?: number;
  /** `noul`: how often the answer is "yes" in the test set (the baseline to beat). */
  positiveRate?: number;
};

export type ReliabilityBin = { lo: number; hi: number; count: number; confidence: number; accuracy: number };
export type AutomationPoint = { threshold: number; coverage: number; accuracy: number; count: number };

export type DecisionReport = {
  rows: number;
  /** Rows that produced at least one scored decision. */
  scoredRows: number;
  decisions: number;
  /** Share of decisions that are right, over every question pooled. */
  accuracy: number;
  /** Mean of the per-question accuracies: no question dominates by being asked more often. */
  macroAccuracy: number;
  /** Rows where EVERY labelled question is right. */
  recordAccuracy: number;
  ece: number;
  brier: number;
  logLoss: number;
  meanConfidence: number;
  questions: QuestionReport[];
  reliability: ReliabilityBin[];
  automation: AutomationPoint[];
  /** Largest share of decisions that can be automated while keeping the accuracy at or above 95% / 90%. */
  coverageAt95: number | null;
  coverageAt90: number | null;
};

const BINS = 10;
const EPS = 1e-6;
export const AUTOMATION_THRESHOLDS = [0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 0.99] as const;

// -------------------------------------------------------------------------------------------------
// Reading the test set
// -------------------------------------------------------------------------------------------------

export type ParsedEvalSet = { rows: EvalRow[]; invalid: number; errors: string[]; meta: Record<string, QuestionMeta> };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The label a gold value stands for, as a string key of the question's options. Null when unusable. */
export function goldLabel(type: QuestionType, options: string[], raw: unknown): string | null {
  const g = isObj(raw) ? raw : { label: raw };
  const probs = isObj(g.probabilities) ? g.probabilities : null;
  if (type === "noul") {
    if (typeof g.label === "boolean") return g.label ? "true" : "false";
    if (typeof g.label === "string" && ["true", "false"].includes(g.label.trim().toLowerCase())) {
      return g.label.trim().toLowerCase();
    }
    const p = typeof g.noul === "number" ? g.noul : probs && typeof probs.true === "number" ? probs.true : null;
    if (p !== null) return p >= 0.5 ? "true" : "false";
    if (probs && typeof probs.false === "number") return probs.false >= 0.5 ? "false" : "true";
    return null;
  }
  if (g.label !== undefined && g.label !== null) {
    const key = type === "score" && typeof g.label === "number" ? String(Math.trunc(g.label)) : String(g.label);
    if (options.includes(key)) return key;
    if (type === "score" && Number.isFinite(Number(g.label))) return String(Math.trunc(Number(g.label)));
  }
  if (probs) {
    let best: string | null = null;
    let top = -Infinity;
    for (const o of options) {
      const v = Number(probs[o]);
      if (Number.isFinite(v) && v > top) {
        top = v;
        best = o;
      }
    }
    return best;
  }
  return null;
}

/**
 * Read a JSONL test set into rows, dropping the ones the trainer would also drop (the same validator),
 * and collect each question's type and options (the union over rows, so rows with different option
 * lists for one question name still share one confusion matrix).
 */
export function parseDecisionEvalSet(jsonl: string): ParsedEvalSet {
  const rows: EvalRow[] = [];
  const errors: string[] = [];
  const meta: Record<string, QuestionMeta> = {};
  let invalid = 0;
  jsonl.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let row: unknown;
    try {
      row = normalizeDecisionRow(JSON.parse(line));
    } catch {
      invalid++;
      if (errors.length < 3) errors.push(`line ${i + 1}: not valid JSON`);
      return;
    }
    const problems = validateDecisionRow(row);
    if (problems.length > 0) {
      invalid++;
      if (errors.length < 3) errors.push(`line ${i + 1}: ${problems[0]}`);
      return;
    }
    const r = row as EvalRow;
    for (const [name, q] of Object.entries(r.questions)) {
      const opts = optionsOf(q.type, q.criteria) ?? [];
      const m = (meta[name] ??= { type: q.type, options: [] });
      if (m.type !== q.type) continue; // the same name with a different type: scored by its first type
      for (const o of opts) if (!m.options.includes(o)) m.options.push(o);
    }
    rows.push(r);
  });
  return { rows, invalid, errors, meta };
}

// -------------------------------------------------------------------------------------------------
// Reading the model's answer (the shapes docker/decision/server.py returns)
// -------------------------------------------------------------------------------------------------

/** One question's answer from `POST /v1/systemone`, or null when it has no usable probabilities. */
export function extractPrediction(type: QuestionType, options: string[], answer: unknown): DecisionPrediction | null {
  if (!isObj(answer)) return null;
  const probsRaw = isObj(answer.probabilities) ? answer.probabilities : {};
  const probs: Record<string, number> = {};
  if (type === "noul") {
    const p =
      typeof answer.noul === "number" ? answer.noul : typeof probsRaw.true === "number" ? (probsRaw.true as number) : null;
    if (p === null || !Number.isFinite(p)) return null;
    probs.true = Math.min(1, Math.max(0, p));
    probs.false = 1 - probs.true;
    return { label: probs.true >= 0.5 ? "true" : "false", probs };
  }
  for (const [k, v] of Object.entries(probsRaw)) if (typeof v === "number" && Number.isFinite(v)) probs[k] = v;
  const keys = Object.keys(probs);
  if (keys.length === 0) return null;
  let label = type === "choice" ? answer.choice ?? answer.answer : answer.answer;
  if (label === undefined || label === null || !(String(label) in probs)) {
    label = keys.reduce((a, b) => (probs[b]! > probs[a]! ? b : a));
  }
  for (const o of options) probs[o] ??= 0;
  return {
    label: String(label),
    probs,
    ...(type === "score" && typeof answer.score === "number" ? { score: answer.score } : {}),
  };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
export const stateText = (state: unknown): string => clip(typeof state === "string" ? state : JSON.stringify(state), 400);

/** Score one row: the gold label of each labelled question against the model's answer. */
export function scoreDecisionCase(
  i: number,
  row: EvalRow,
  answers: Record<string, unknown>,
  meta: Record<string, QuestionMeta>
): DecisionCase {
  const results: Record<string, DecisionResult> = {};
  let unanswered = 0;
  for (const [name, rawGold] of Object.entries(row.gold)) {
    const q = row.questions[name];
    const m = meta[name];
    if (!q || !m || q.type !== m.type) continue;
    const gold = goldLabel(q.type, m.options, rawGold);
    const pred = extractPrediction(q.type, m.options, answers[name]);
    if (gold === null) continue;
    if (pred === null) {
      unanswered++;
      continue;
    }
    results[name] = {
      gold,
      pred: pred.label,
      conf: pred.probs[pred.label] ?? 0,
      pGold: pred.probs[gold] ?? 0,
      probs: pred.probs,
      correct: pred.label === gold,
    };
  }
  return { i, state: stateText(row.state), results, ...(unanswered ? { unanswered } : {}) };
}

// -------------------------------------------------------------------------------------------------
// Metrics
// -------------------------------------------------------------------------------------------------

type Point = { conf: number; correct: boolean; pGold: number; probs: Record<string, number>; gold: string };

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Expected calibration error with equal-width confidence bins. Also returns the bins (reliability diagram). */
export function calibration(points: ReadonlyArray<Pick<Point, "conf" | "correct">>): { ece: number; bins: ReliabilityBin[] } {
  const bins = Array.from({ length: BINS }, (_, b) => ({ lo: b / BINS, hi: (b + 1) / BINS, n: 0, conf: 0, hit: 0 }));
  for (const p of points) {
    const b = Math.min(BINS - 1, Math.floor(p.conf * BINS));
    bins[b]!.n++;
    bins[b]!.conf += p.conf;
    bins[b]!.hit += p.correct ? 1 : 0;
  }
  const N = points.length;
  let ece = 0;
  const out: ReliabilityBin[] = bins.map((b) => {
    const confidence = b.n ? b.conf / b.n : 0;
    const accuracy = b.n ? b.hit / b.n : 0;
    if (N && b.n) ece += (b.n / N) * Math.abs(accuracy - confidence);
    return { lo: b.lo, hi: b.hi, count: b.n, confidence, accuracy };
  });
  return { ece, bins: out };
}

/** Multi-class Brier score: mean over decisions of the squared distance from the one-hot truth (0 best, 2 worst). */
function brierOf(points: Point[]): number {
  return mean(
    points.map((p) => {
      let s = 0;
      for (const [k, v] of Object.entries(p.probs)) s += (v - (k === p.gold ? 1 : 0)) ** 2;
      if (!(p.gold in p.probs)) s += 1;
      return s;
    })
  );
}

const logLossOf = (points: Point[]) => mean(points.map((p) => -Math.log(Math.max(p.pGold, EPS))));

function questionReport(name: string, meta: QuestionMeta, points: Point[], preds: string[]): QuestionReport {
  const accuracy = mean(points.map((p) => (p.correct ? 1 : 0)));
  const rep: QuestionReport = {
    name,
    type: meta.type,
    options: meta.options,
    n: points.length,
    accuracy,
    meanConfidence: mean(points.map((p) => p.conf)),
    ece: calibration(points).ece,
    brier: brierOf(points),
    logLoss: logLossOf(points),
  };
  if (meta.type === "score") {
    const diffs = points.map((p, i) => Math.abs(Number(preds[i]) - Number(p.gold)));
    rep.mae = mean(diffs);
    rep.within1 = mean(diffs.map((d) => (d <= 1 ? 1 : 0)));
    return rep;
  }
  const labels = meta.type === "noul" ? ["true", "false"] : meta.options;
  const confusion: Record<string, Record<string, number>> = {};
  points.forEach((p, i) => {
    const row = (confusion[p.gold] ??= {});
    row[preds[i]!] = (row[preds[i]!] ?? 0) + 1;
  });
  const perClass: Record<string, ClassStat> = {};
  for (const l of labels) {
    const tp = confusion[l]?.[l] ?? 0;
    const support = Object.values(confusion[l] ?? {}).reduce((a, b) => a + b, 0);
    const predicted = Object.values(confusion).reduce((a, r) => a + (r[l] ?? 0), 0);
    const precision = predicted ? tp / predicted : 0;
    const recall = support ? tp / support : 0;
    perClass[l] = { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0, support };
  }
  const present = labels.filter((l) => perClass[l]!.support > 0);
  rep.macroF1 = mean(present.map((l) => perClass[l]!.f1));
  rep.perClass = perClass;
  rep.confusion = confusion;
  if (meta.type === "noul") rep.positiveRate = mean(points.map((p) => (p.gold === "true" ? 1 : 0)));
  return rep;
}

/** Largest share of decisions automatable while the accuracy of the automated ones stays >= `target`. */
export function coverageAtAccuracy(points: ReadonlyArray<Pick<Point, "conf" | "correct">>, target: number): number | null {
  const sorted = [...points].sort((a, b) => b.conf - a.conf);
  let hits = 0;
  let best: number | null = null;
  sorted.forEach((p, k) => {
    hits += p.correct ? 1 : 0;
    const boundary = k === sorted.length - 1 || sorted[k + 1]!.conf !== p.conf; // never cut inside a tie
    if (boundary && hits / (k + 1) >= target) best = (k + 1) / sorted.length;
  });
  return best;
}

export function buildDecisionReport(cases: DecisionCase[], meta: Record<string, QuestionMeta>, totalRows = cases.length): DecisionReport {
  const scored = cases.filter((c) => !c.error && Object.keys(c.results).length > 0);
  const byQuestion = new Map<string, Point[]>();
  const predsByQuestion = new Map<string, string[]>();
  const all: Point[] = [];
  for (const c of scored) {
    for (const [name, r] of Object.entries(c.results)) {
      const pt: Point = { conf: r.conf, correct: r.correct, pGold: r.pGold, probs: r.probs, gold: r.gold };
      (byQuestion.get(name) ?? byQuestion.set(name, []).get(name)!).push(pt);
      (predsByQuestion.get(name) ?? predsByQuestion.set(name, []).get(name)!).push(r.pred);
      all.push(pt);
    }
  }
  const questions = [...byQuestion.entries()]
    .map(([name, pts]) => questionReport(name, meta[name] ?? { type: "choice", options: [] }, pts, predsByQuestion.get(name)!))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  const { ece, bins } = calibration(all);
  return {
    rows: totalRows,
    scoredRows: scored.length,
    decisions: all.length,
    accuracy: mean(all.map((p) => (p.correct ? 1 : 0))),
    macroAccuracy: mean(questions.map((q) => q.accuracy)),
    recordAccuracy: mean(scored.map((c) => (!c.unanswered && Object.values(c.results).every((r) => r.correct) ? 1 : 0))),
    ece,
    brier: brierOf(all),
    logLoss: logLossOf(all),
    meanConfidence: mean(all.map((p) => p.conf)),
    questions,
    reliability: bins,
    automation: AUTOMATION_THRESHOLDS.map((t) => {
      const kept = all.filter((p) => p.conf >= t);
      return { threshold: t, coverage: all.length ? kept.length / all.length : 0, accuracy: mean(kept.map((p) => (p.correct ? 1 : 0))), count: kept.length };
    }),
    coverageAt95: coverageAtAccuracy(all, 0.95),
    coverageAt90: coverageAtAccuracy(all, 0.9),
  };
}
