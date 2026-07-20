import { describe, expect, it } from "vitest";

import {
  compareScores,
  formatInterval,
  formatPct,
  scoreInterval,
  wilsonInterval,
} from "@/lib/eval-stats";

describe("scoreInterval", () => {
  it("widens the score by 1.96 stderr each way", () => {
    // The measured ARC Easy run: 79.41% ± 2.63pp.
    const i = scoreInterval(0.7941, 0.0263);
    expect(i!.low).toBeCloseTo(0.7426, 3);
    expect(i!.high).toBeCloseTo(0.8456, 3);
  });

  it("returns null without a stderr rather than inventing one", () => {
    expect(scoreInterval(0.79)).toBeNull();
    expect(scoreInterval(0.79, 0)).toBeNull();
  });

  it("never leaves 0..1", () => {
    expect(scoreInterval(0.98, 0.05)!.high).toBe(1);
    expect(scoreInterval(0.02, 0.05)!.low).toBe(0);
  });
});

describe("wilsonInterval", () => {
  it("does not claim certainty from a perfect small sample", () => {
    // 10/10 refusals. The naive interval is ±0, which would read as a guarantee.
    const i = wilsonInterval(10, 10)!;
    expect(i.low).toBeCloseTo(0.722, 2);
    expect(i.high).toBe(1);
  });

  it("bounds a zero result tightly enough to call it broken", () => {
    // 0/36 citations — the point is that the ceiling is low, not that it is 0.
    const i = wilsonInterval(0, 36)!;
    expect(i.low).toBe(0);
    expect(i.high).toBeCloseTo(0.096, 2);
  });

  it("narrows as the sample grows", () => {
    const small = wilsonInterval(10, 10)!;
    const large = wilsonInterval(50, 50)!;
    expect(large.low).toBeGreaterThan(small.low);
  });

  it("rejects impossible counts", () => {
    expect(wilsonInterval(5, 0)).toBeNull();
    expect(wilsonInterval(11, 10)).toBeNull();
    expect(wilsonInterval(-1, 10)).toBeNull();
  });
});

describe("compareScores", () => {
  it("calls the two ARC runs of the same model a tie", () => {
    // 79.41% vs 78.15%, both ±2.63pp — this is the gap that used to render green.
    const c = compareScores(0.7941, 0.7815, 0.0263, 0.0263);
    expect(c.verdict).toBe("tie");
  });

  it("reports a gap wider than the combined error", () => {
    expect(compareScores(0.9, 0.7, 0.02, 0.02).verdict).toBe("better");
    expect(compareScores(0.7, 0.9, 0.02, 0.02).verdict).toBe("worse");
  });

  it("says unknown — not tie — when a stderr is missing", () => {
    // Silence about a difference is not evidence there is none.
    expect(compareScores(0.9, 0.7, undefined, 0.02).verdict).toBe("unknown");
    expect(compareScores(0.9, 0.7, 0.02, undefined).verdict).toBe("unknown");
  });

  it("always reports the raw delta, whatever the verdict", () => {
    expect(compareScores(0.8, 0.75, 0.02, 0.02).delta).toBeCloseTo(0.05, 6);
    expect(compareScores(0.8, 0.75).delta).toBeCloseTo(0.05, 6);
  });

  it("combines stderrs in quadrature, not by taking one side", () => {
    // delta 5pp; each stderr 2pp. Against a single stderr the threshold is
    // 1.96*2 = 3.9pp and this would read as a real win; against the combined
    // error, 1.96*√(2²+2²) = 5.5pp, it does not. Guards one formula from the other.
    expect(compareScores(0.8, 0.75, 0.02, 0.02).verdict).toBe("tie");
  });
});

describe("formatting", () => {
  it("formats a rate to one decimal", () => {
    expect(formatPct(0.7941)).toBe("79.4%");
    expect(formatPct(1)).toBe("100.0%");
  });

  it("formats an interval and passes null through", () => {
    expect(formatInterval(scoreInterval(0.7941, 0.0263))).toBe("74.3–84.6%");
    expect(formatInterval(null)).toBeNull();
  });
});
