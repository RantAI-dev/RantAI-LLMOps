/**
 * Turning eval numbers into claims a reader is allowed to make.
 *
 * Every rate on the Evals screen comes from a finite number of questions, so two
 * scores can differ without the models differing. Two runs of the SAME model on
 * ARC Easy scored 79.4% and 78.2% — a gap that reads as a win until you notice
 * the harness reported ±2.6 points on each. These helpers exist so the UI can
 * say "no measurable difference" instead of colouring that gap green.
 */

/** 95% coverage of a normal distribution. */
const Z95 = 1.96;

export type Interval = { low: number; high: number };

/** Clamp to 0..1 — a rate cannot leave its range however wide the interval is. */
function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * 95% confidence interval around a score the harness already gave a stderr for.
 * Returns null when there is no stderr: an interval we invented would be worse
 * than none, because it would look equally authoritative.
 */
export function scoreInterval(score: number, stderr?: number): Interval | null {
  if (stderr == null || !Number.isFinite(stderr) || stderr <= 0) return null;
  return { low: clamp01(score - Z95 * stderr), high: clamp01(score + Z95 * stderr) };
}

/**
 * 95% Wilson interval for `hits` out of `n`.
 *
 * Used for the grounding rates, which have no stderr of their own and whose
 * denominators are small. The normal approximation is useless exactly where we
 * need it — at 10/10 it gives ±0, claiming certainty from ten examples. Wilson
 * gives 72%..100%, which is the honest reading.
 */
export function wilsonInterval(hits: number, n: number): Interval | null {
  if (!Number.isFinite(hits) || !Number.isFinite(n) || n <= 0 || hits < 0 || hits > n) return null;
  const p = hits / n;
  const z2 = Z95 * Z95;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (Z95 / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return { low: clamp01(centre - half), high: clamp01(centre + half) };
}

export type Comparison =
  /** The gap is larger than the combined measurement error. */
  | { verdict: "better" | "worse"; delta: number }
  /** There is a gap, but it is inside the error — the runs are indistinguishable. */
  | { verdict: "tie"; delta: number }
  /** At least one side has no stderr, so no claim can be made either way. */
  | { verdict: "unknown"; delta: number };

/**
 * Compare a score against a baseline.
 *
 * Two independent measurements differ meaningfully when the gap exceeds the
 * error of the DIFFERENCE, which is the two stderrs added in quadrature — not
 * either one alone. Without both stderrs the answer is "unknown", never "tie":
 * silence about a difference is not evidence there is none.
 */
export function compareScores(
  score: number,
  baseline: number,
  stderr?: number,
  baselineStderr?: number
): Comparison {
  const delta = score - baseline;
  if (stderr == null || baselineStderr == null) return { verdict: "unknown", delta };
  const combined = Math.sqrt(stderr * stderr + baselineStderr * baselineStderr);
  if (Math.abs(delta) <= Z95 * combined) return { verdict: "tie", delta };
  return { verdict: delta > 0 ? "better" : "worse", delta };
}

/** "79.4%" — one decimal, because the error bar is rarely smaller than that. */
export function formatPct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** "74.3–84.6%" for an interval, or null when there is nothing to show. */
export function formatInterval(interval: Interval | null): string | null {
  if (!interval) return null;
  return `${(interval.low * 100).toFixed(1)}–${(interval.high * 100).toFixed(1)}%`;
}
