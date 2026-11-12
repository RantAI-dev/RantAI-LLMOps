/**
 * Scoring for an image-and-text (VLM) eval on the user's OWN test set.
 *
 * A row is an image, a prompt and a key (the assistant message of the row). The served model answers
 * the prompt about the image and the answer is compared with the key by a per-set `scoring` mode:
 *
 *  - `exact`    lowercase, trim, collapse whitespace, drop trailing punctuation, then equal.
 *  - `latex`    for formulas: code fences and `$`/`$$`/`\[ \]`/`\( \)` wrappers are dropped and ALL
 *               whitespace removed, then equal. Also the character error rate (CER): edit distance
 *               over the length of the key, so "almost right" is visible next to the exact match.
 *  - `numeric`  ChartQA "relaxed accuracy": numbers match within 5% of the key (exactly when the key
 *               is 0); anything else is compared as `exact`.
 *  - `anls`     Average Normalised Levenshtein Similarity (DocVQA): similarity below 0.5 counts as 0.
 *  - `choice`   multiple choice: the letter A-E found in the answer against the letter of the key.
 *
 * Deterministic and pure (no Node or browser APIs, no LLM judge): a stored run can be re-scored for free.
 * A request that FAILED is not a wrong answer: it carries `error` and is left out of every metric, the
 * way the Decision eval does it, so a report says how many rows it really covers.
 */
import { compareScores, scoreInterval, type Comparison, type Interval } from "@/lib/eval-stats";

export const VLM_SCORING_MODES = ["exact", "latex", "numeric", "anls", "choice"] as const;
export type VlmScoring = (typeof VLM_SCORING_MODES)[number];

export const isVlmScoring = (v: unknown): v is VlmScoring => typeof v === "string" && (VLM_SCORING_MODES as readonly string[]).includes(v);

export const VLM_SCORING_LABEL: Record<VlmScoring, string> = {
  exact: "Exact match",
  latex: "LaTeX (exact + CER)",
  numeric: "Numeric (±5%)",
  anls: "ANLS (document QA)",
  choice: "Multiple choice (A-E)",
};

export type VlmScore = {
  correct: boolean;
  /** 0..1. 0 or 1 for every mode but `anls`, which gives the similarity when it reaches the threshold. */
  score: number;
  /** `latex` only: character error rate. Not capped at 1: an answer far longer than the key can exceed it. */
  cer?: number;
};

// -------------------------------------------------------------------------------------------------
// Edit distance
// -------------------------------------------------------------------------------------------------

/** Levenshtein distance over Unicode code points (insert, delete, substitute: all cost 1). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const x = Array.from(a);
  const y = Array.from(b);
  if (x.length === 0) return y.length;
  if (y.length === 0) return x.length;
  // Keep the shorter string on the inner loop: the two rows are as short as they can be.
  const [s, t] = x.length <= y.length ? [x, y] : [y, x];
  let prev = Array.from({ length: s.length + 1 }, (_, i) => i);
  let cur = new Array<number>(s.length + 1).fill(0);
  for (let j = 1; j <= t.length; j++) {
    cur[0] = j;
    for (let i = 1; i <= s.length; i++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[i] = Math.min(prev[i]! + 1, cur[i - 1]! + 1, prev[i - 1]! + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[s.length]!;
}

// -------------------------------------------------------------------------------------------------
// Normalisers
// -------------------------------------------------------------------------------------------------

const TRAILING_PUNCT = /[\s.,;:!?…。！？，；：]+$/u;

/** `exact` mode: lowercase, trim, collapse runs of whitespace, drop trailing punctuation. */
export function normalizeExact(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim().replace(TRAILING_PUNCT, "").trim();
}

/**
 * `latex` mode: what is left of an answer once the wrapping is gone. A fenced block (```latex ... ```) is
 * unwrapped, even when the model wrote a sentence around it; then `$$..$$`, `$..$`, `\[..\]` and `\(..\)`
 * (nested ones too); then every whitespace character is removed, since LaTeX does not care about them.
 */
export function normalizeLatex(s: string): string {
  let t = s.trim();
  const fence = /```[A-Za-z]*[ \t]*\r?\n?([\s\S]*?)```/.exec(t);
  if (fence) t = fence[1]!.trim();
  for (;;) {
    const before = t;
    if (t.length >= 4 && t.startsWith("$$") && t.endsWith("$$")) t = t.slice(2, -2).trim();
    else if (t.length >= 2 && t.startsWith("$") && t.endsWith("$")) t = t.slice(1, -1).trim();
    else if (t.startsWith("\\[") && t.endsWith("\\]")) t = t.slice(2, -2).trim();
    else if (t.startsWith("\\(") && t.endsWith("\\)")) t = t.slice(2, -2).trim();
    if (t === before) break;
  }
  return t.replace(/\s+/g, "");
}

const THOUSANDS = /^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const NUMBER = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i;

/**
 * A number as written in a chart answer: `%`, `$`, other currency signs and the spaces around them are dropped,
 * and commas only when they group thousands ("1,234.5"); "1,5" is not read as 15. Null when it is not a number.
 * A space may group thousands ("6 536"). Any other space between digits ("1 2", "3 4 . 6") is NOT read as one
 * number: that is a model writing character by character (the LaTeX_OCR adapters did exactly this on ChartQA),
 * and reading it as 12 hid the regression.
 */
export function parseNumber(s: string): number | null {
  if (/\d\s+[\d.,]|[\d.,]\s+\d/.test(s) && !/^[-+−–]?\d{1,3}(\s\d{3})+(\.\d+)?$/.test(s.trim().replace(/\s*[%$€£]\s*/g, ""))) {
    return null;
  }
  let t = s.trim().replace(/[−–]/g, "-").replace(/[%$€£\s]/g, "").replace(/\.+$/, "");
  if (THOUSANDS.test(t)) t = t.replace(/,/g, "");
  if (!NUMBER.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * The option letter (A-E) an answer stands for, or null. Accepts "B", "(B)", "B.", "B) text", "**B**",
 * "Answer: B", "The answer is (B)". A leading "A cat..." is NOT read as option A: a bare capital letter
 * counts only when a delimiter follows it.
 */
export function extractChoice(s: string): string | null {
  const t = s.replace(/[*`_]/g, "").trim();
  const whole = /^\(?([A-Ea-e])\)?[.):]?$/.exec(t);
  if (whole) return whole[1]!.toUpperCase();
  const lead = /^\(?([A-E])(?:\)|[.:])(?![A-Za-z0-9])/.exec(t) ?? /^\(([A-Ea-e])\)/.exec(t);
  if (lead) return lead[1]!.toUpperCase();
  const said = /\b(?:[Aa]nswer|[Oo]ption|[Cc]hoice)\b\s*(?:is|:|=)?\s*[:(\s]*([A-E])(?![A-Za-z0-9])/.exec(t);
  return said ? said[1]!.toUpperCase() : null;
}

// -------------------------------------------------------------------------------------------------
// Scoring one case
// -------------------------------------------------------------------------------------------------

const hit = (correct: boolean, extra: Partial<VlmScore> = {}): VlmScore => ({ correct, score: correct ? 1 : 0, ...extra });

/** ANLS threshold: a normalised distance of 0.5 or more scores 0. */
export const ANLS_THRESHOLD = 0.5;

/** Score one answer against its key. `pred` and `gold` are raw text. */
export function scoreVlm(mode: VlmScoring, pred: string, gold: string): VlmScore {
  switch (mode) {
    case "exact":
      return hit(normalizeExact(pred) === normalizeExact(gold));
    case "latex": {
      const p = normalizeLatex(pred);
      const g = normalizeLatex(gold);
      return hit(p === g, { cer: levenshtein(p, g) / Math.max(1, Array.from(g).length) });
    }
    case "numeric": {
      const p = parseNumber(pred);
      const g = parseNumber(gold);
      if (p !== null && g !== null) {
        return hit(g === 0 ? p === 0 : Math.abs(p - g) <= 0.05 * Math.abs(g) + 1e-12);
      }
      return hit(normalizeExact(pred) === normalizeExact(gold));
    }
    case "anls": {
      const p = normalizeExact(pred);
      const g = normalizeExact(gold);
      const longest = Math.max(Array.from(p).length, Array.from(g).length);
      const nl = longest === 0 ? 0 : levenshtein(p, g) / longest;
      const score = nl < ANLS_THRESHOLD ? 1 - nl : 0;
      return { correct: score > 0, score };
    }
    case "choice": {
      const g = extractChoice(gold);
      // A key that is not a letter (the option's text): compare the answers as plain text.
      if (g === null) return hit(normalizeExact(pred) === normalizeExact(gold));
      return hit(extractChoice(pred) === g);
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Cases and the report
// -------------------------------------------------------------------------------------------------

/** One test row with the model's answer and its score. */
export type VlmCase = {
  /** Index of the row in its test set: the same row has the same id in every run on that set. */
  id: number;
  /** First image of the row (path inside the set), for the thumbnail. */
  image?: string;
  prompt: string;
  gold: string;
  pred: string;
  correct: boolean;
  score: number;
  cer?: number;
  /** The request failed: the row is NOT scored and counts in `errors`. */
  error?: string;
  category?: string;
  tokens?: number;
  latencyMs?: number;
  /** The answer hit `max_tokens` (finish_reason "length"). */
  truncated?: boolean;
};

export type VlmCategoryReport = {
  category: string;
  n: number;
  correct: number;
  accuracy: number;
  interval: Interval | null;
  meanCer?: number;
};

export type VlmEvalReport = {
  mode: VlmScoring;
  /** Rows in the run, scored or not. */
  rows: number;
  /** Rows with a usable answer: the denominator of every rate below. */
  scored: number;
  /** Rows whose request failed (not scored). */
  errors: number;
  correct: number;
  accuracy: number;
  stderr: number;
  /** 95% interval around the accuracy. */
  interval: Interval | null;
  /** Mean per-row score (the ANLS for `anls`; equals the accuracy for the 0/1 modes). */
  meanScore: number;
  /** `latex` only. */
  meanCer?: number;
  /** Scored rows where the model answered nothing. */
  empty: number;
  /** Scored rows cut off by `max_tokens`. */
  truncated: number;
  categories: VlmCategoryReport[];
  meanLatencyMs?: number;
  /** Completion tokens over the scored rows that reported them. */
  completionTokens?: number;
};

/**
 * Standard error of a rate. At 0% or 100% the plain formula says 0, which would claim certainty from a
 * finite sample, so the edge cases use the Agresti-Coull adjusted rate instead.
 */
export function rateStderr(hits: number, n: number): number {
  if (n <= 0) return 0;
  const p = hits / n;
  if (p > 0 && p < 1) return Math.sqrt((p * (1 - p)) / n);
  const adj = (hits + 2) / (n + 4);
  return Math.sqrt((adj * (1 - adj)) / (n + 4));
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
const isScored = (c: VlmCase): boolean => !c.error;

function rate(correct: number, n: number): { accuracy: number; stderr: number; interval: Interval | null } {
  const accuracy = n ? correct / n : 0;
  const stderr = rateStderr(correct, n);
  return { accuracy, stderr, interval: n ? scoreInterval(accuracy, stderr) : null };
}

/** Roll the cases of a run up into the numbers on the Evals screen. Cases with `error` are counted, not scored. */
export function buildVlmReport(cases: VlmCase[], mode: VlmScoring): VlmEvalReport {
  const scored = cases.filter(isScored);
  const correct = scored.filter((c) => c.correct).length;
  const cers = scored.map((c) => c.cer).filter((v): v is number => typeof v === "number");
  const latencies = scored.map((c) => c.latencyMs).filter((v): v is number => typeof v === "number");
  const tokens = scored.map((c) => c.tokens).filter((v): v is number => typeof v === "number");
  const report: VlmEvalReport = {
    mode,
    rows: cases.length,
    scored: scored.length,
    errors: cases.length - scored.length,
    correct,
    ...rate(correct, scored.length),
    meanScore: scored.length ? mean(scored.map((c) => c.score)) : 0,
    empty: scored.filter((c) => c.pred.trim() === "").length,
    truncated: scored.filter((c) => c.truncated).length,
    categories: [],
  };
  if (mode === "latex" && cers.length) report.meanCer = mean(cers);
  if (latencies.length) report.meanLatencyMs = mean(latencies);
  if (tokens.length) report.completionTokens = tokens.reduce((a, b) => a + b, 0);

  if (scored.some((c) => c.category)) {
    const groups = new Map<string, VlmCase[]>();
    for (const c of scored) {
      const key = c.category || "(none)";
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    report.categories = [...groups.entries()]
      .map(([category, rows]): VlmCategoryReport => {
        const ok = rows.filter((c) => c.correct).length;
        const catCers = rows.map((c) => c.cer).filter((v): v is number => typeof v === "number");
        const r = rate(ok, rows.length);
        return {
          category,
          n: rows.length,
          correct: ok,
          accuracy: r.accuracy,
          interval: r.interval,
          ...(mode === "latex" && catCers.length ? { meanCer: mean(catCers) } : {}),
        };
      })
      .sort((a, b) => b.n - a.n || a.category.localeCompare(b.category));
  }
  return report;
}

// -------------------------------------------------------------------------------------------------
// Comparing two runs on the same set
// -------------------------------------------------------------------------------------------------

export type VlmComparison = {
  /** Rows scored in BOTH runs: every number below is over these, so the two sides are like for like. */
  paired: number;
  accA: number;
  accB: number;
  intervalA: Interval | null;
  intervalB: Interval | null;
  /** accB - accA. */
  delta: number;
  /** Is the gap larger than the combined measurement error? (see eval-stats `compareScores`) */
  verdict: Comparison["verdict"];
  /** Mean CER of each side over the paired rows (`latex` runs only). */
  cerA?: number;
  cerB?: number;
  cerDelta?: number;
  /** Row ids: wrong in A and right in B / right in A and wrong in B. */
  improved: number[];
  regressed: number[];
};

/** Compare run A (the baseline) with run B on the rows both scored. */
export function compareVlmCases(a: VlmCase[], b: VlmCase[]): VlmComparison {
  const inB = new Map(b.filter(isScored).map((c) => [c.id, c]));
  const pairs = a.filter(isScored).flatMap((ca) => {
    const cb = inB.get(ca.id);
    return cb ? [{ ca, cb }] : [];
  });
  const n = pairs.length;
  const hitsA = pairs.filter((p) => p.ca.correct).length;
  const hitsB = pairs.filter((p) => p.cb.correct).length;
  const rA = rate(hitsA, n);
  const rB = rate(hitsB, n);
  const cmp = n ? compareScores(rB.accuracy, rA.accuracy, rB.stderr, rA.stderr) : ({ verdict: "unknown", delta: 0 } as Comparison);
  const cersA = pairs.map((p) => p.ca.cer).filter((v): v is number => typeof v === "number");
  const cersB = pairs.map((p) => p.cb.cer).filter((v): v is number => typeof v === "number");
  const out: VlmComparison = {
    paired: n,
    accA: rA.accuracy,
    accB: rB.accuracy,
    intervalA: rA.interval,
    intervalB: rB.interval,
    delta: cmp.delta,
    verdict: cmp.verdict,
    improved: pairs.filter((p) => !p.ca.correct && p.cb.correct).map((p) => p.ca.id),
    regressed: pairs.filter((p) => p.ca.correct && !p.cb.correct).map((p) => p.ca.id),
  };
  if (cersA.length && cersA.length === cersB.length) {
    out.cerA = mean(cersA);
    out.cerB = mean(cersB);
    out.cerDelta = out.cerB - out.cerA;
  }
  return out;
}
