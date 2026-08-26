/**
 * Scoring for a CLASSIFICATION eval: given examples shaped like the SFT data
 * (`instruction` = the input, `output` = the single true label) plus what a model
 * actually replied, produce the metrics a classifier is judged on — Accuracy,
 * per-class Precision / Recall / F1, Macro-F1, and a confusion matrix.
 *
 * Deliberately deterministic — no LLM judge. The predicted label is the known
 * label that appears in the model's reply; every number is a pure function of the
 * stored text, so a run can be re-scored for free and the score never drifts.
 *
 * This is the metric family the module's "Evaluasi Before vs After" step needs
 * (a held-out test set, Accuracy/Macro-F1), which the benchmark and grounding
 * evals do not produce.
 */
import { parseEvalJsonl, type EvalExample } from "@/lib/grounding-eval";

export { parseEvalJsonl };
export type { EvalExample };

/** No known label found in the reply — counted as a miss, never a class. */
export const UNKNOWN = "UNKNOWN";

/**
 * Nudge the model to emit only the label, so parsing is clean. Offered as an
 * editable default in the UI — a prompt-only baseline is what tells you whether
 * the fine-tune earned its cost.
 */
export const DEFAULT_CLASSIFICATION_PROMPT = [
  "Anda adalah pengklasifikasi. Tentukan SATU label yang paling sesuai untuk input.",
  "Jawab HANYA dengan nama label-nya — tanpa penjelasan, tanpa tanda baca tambahan.",
].join("\n");

/** One example plus the model's reply, scored to a predicted label. */
export type ClassCase = {
  instruction: string;
  /** The true label. */
  expected: string;
  /** The raw model reply. */
  actual: string;
  /** The label parsed out of the reply, or UNKNOWN. */
  predicted: string;
  correct: boolean;
};

export type ClassStats = { precision: number; recall: number; f1: number; support: number };

export type ClassificationReport = {
  total: number;
  accuracy: number;
  macroF1: number;
  macroPrecision: number;
  macroRecall: number;
  weightedF1: number;
  /** Replies where no known label could be parsed — a miss that isn't in the matrix. */
  unknownCount: number;
  labels: string[];
  perClass: Record<string, ClassStats>;
  /** rows = true label, cols = predicted label, both indexed by `labels`. */
  confusion: number[][];
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The distinct true labels in an eval set, sorted — the class set to score over. */
export function deriveLabels(examples: EvalExample[]): string[] {
  return [...new Set(examples.map((e) => e.output.trim()).filter(Boolean))].sort();
}

/**
 * Which known label the reply names. A whole-word match wins first (so "Zeus"
 * doesn't match inside another word); a loose substring is the fallback for
 * multi-word labels. Returns UNKNOWN when none is present.
 */
export function parsePrediction(reply: string, labels: string[]): string {
  const low = reply.toLowerCase();
  for (const l of labels) {
    if (new RegExp(`\\b${escapeRegExp(l.toLowerCase())}\\b`).test(low)) return l;
  }
  for (const l of labels) {
    if (low.includes(l.toLowerCase())) return l;
  }
  return UNKNOWN;
}

export function scoreClassCase(example: EvalExample, actual: string, labels: string[]): ClassCase {
  const expected = example.output.trim();
  const predicted = parsePrediction(actual, labels);
  return { instruction: example.instruction, expected, actual, predicted, correct: predicted === expected };
}

/** Re-derive a stored case's predicted label with the current parser (no model call). */
export function rescoreClassCase(c: ClassCase, labels: string[]): ClassCase {
  return scoreClassCase({ instruction: c.instruction, output: c.expected }, c.actual, labels);
}

export function buildClassificationReport(cases: ClassCase[], labels: string[]): ClassificationReport {
  const idx = new Map(labels.map((l, i) => [l, i]));
  const n = labels.length;
  const confusion = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const support = new Array<number>(n).fill(0);
  let unknownCount = 0;

  for (const c of cases) {
    const ti = idx.get(c.expected);
    if (ti === undefined) continue; // expected label outside the set — ignore
    support[ti]++;
    const pi = idx.get(c.predicted);
    if (pi === undefined) {
      unknownCount++; // predicted UNKNOWN (or off-set): a miss for this true class
      continue;
    }
    confusion[ti][pi]++;
  }

  const total = cases.length;
  let correct = 0;
  for (let i = 0; i < n; i++) correct += confusion[i][i];
  const accuracy = total ? correct / total : 0;

  const perClass: Record<string, ClassStats> = {};
  let f1Sum = 0;
  let pSum = 0;
  let rSum = 0;
  let weightedF1 = 0;
  let supportSum = 0;
  for (let i = 0; i < n; i++) {
    const tp = confusion[i][i];
    let colSum = 0;
    for (let r = 0; r < n; r++) colSum += confusion[r][i];
    const fp = colSum - tp;
    const fn = support[i] - tp; // includes rows predicted UNKNOWN
    const precision = tp + fp ? tp / (tp + fp) : 0;
    const recall = tp + fn ? tp / (tp + fn) : 0;
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
    perClass[labels[i]] = { precision, recall, f1, support: support[i] };
    f1Sum += f1;
    pSum += precision;
    rSum += recall;
    weightedF1 += f1 * support[i];
    supportSum += support[i];
  }

  return {
    total,
    accuracy,
    macroF1: n ? f1Sum / n : 0,
    macroPrecision: n ? pSum / n : 0,
    macroRecall: n ? rSum / n : 0,
    weightedF1: supportSum ? weightedF1 / supportSum : 0,
    unknownCount,
    labels,
    perClass,
    confusion,
  };
}
