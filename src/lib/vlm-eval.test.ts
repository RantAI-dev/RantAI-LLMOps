import { describe, expect, it } from "vitest";

import {
  buildVlmReport,
  compareVlmCases,
  extractChoice,
  isVlmScoring,
  levenshtein,
  normalizeExact,
  normalizeLatex,
  parseNumber,
  rateStderr,
  scoreVlm,
  type VlmCase,
} from "@/lib/vlm-eval";

describe("levenshtein", () => {
  it.each([
    ["", "", 0],
    ["abc", "", 3],
    ["", "abc", 3],
    ["abc", "abc", 0],
    ["kitten", "sitting", 3],
    ["flaw", "lawn", 2],
    ["a", "b", 1],
    ["abc", "abcd", 1],
    ["\\frac{a}{b}", "\\frac{a}{c}", 1],
  ])("%j vs %j is %i", (a, b, d) => {
    expect(levenshtein(a, b)).toBe(d);
    expect(levenshtein(b, a)).toBe(d);
  });

  it("counts a code point (an emoji, an accented letter) as one edit", () => {
    expect(levenshtein("a😀b", "ab")).toBe(1);
    expect(levenshtein("é", "e")).toBe(1);
  });
});

describe("normalizeExact", () => {
  it.each([
    ["Yes.", "yes"],
    ["  YES  ", "yes"],
    ["a   b\n\tc", "a b c"],
    ["Hello, world!?", "hello, world"],
    ["34.6", "34.6"],
    ["done ...", "done"],
    ["", ""],
    ["...", ""],
    ["Ya。", "ya"],
  ])("%j -> %j", (raw, want) => {
    expect(normalizeExact(raw)).toBe(want);
  });
});

describe("normalizeLatex", () => {
  it.each([
    ["\\frac{a}{b}", "\\frac{a}{b}"],
    ["$\\frac{a}{b}$", "\\frac{a}{b}"],
    ["$$ \\frac{a}{b} $$", "\\frac{a}{b}"],
    ["\\[ x^2 \\]", "x^2"],
    ["\\( x^2 \\)", "x^2"],
    ["```latex\nx ^ { 2 }\n```", "x^{2}"],
    ["```\nx^2\n```", "x^2"],
    ["```tex x^2```", "x^2"],
    ["Here is the code:\n```latex\n$x^2$\n```\nHope it helps", "x^2"],
    ["( 1 - \\Pi ) \\ \\xi = 0 ,", "(1-\\Pi)\\\\xi=0,"],
    ["$ $x$ $", "x"],
    ["$", "$"],
    ["", ""],
  ])("%j -> %j", (raw, want) => {
    expect(normalizeLatex(raw)).toBe(want);
  });
});

describe("parseNumber", () => {
  it.each([
    ["34.6", 34.6],
    ["34.6%", 34.6],
    ["$1,234.50", 1234.5],
    ["1,234", 1234],
    ["-5", -5],
    ["−5", -5],
    ["+7", 7],
    [" 12 ", 12],
    ["12 %", 12],
    ["$ 12", 12],
    ["6 536", 6536],
    ["519 462", 519462],
    ["12 345.5%", 12345.5],
    ["12.", 12],
    [".5", 0.5],
    ["1e3", 1000],
    ["0", 0],
  ])("%j parses as %d", (raw, want) => {
    expect(parseNumber(raw)).toBe(want);
  });

  it.each([["abc"], [""], ["1,5"], ["12 apples"], ["1.2.3"], ["--5"], ["NaN"], ["Infinity"], ["1 2"], ["1 0 3 . 7"], ["3 4 . 6 %"], ["1 , 234"], ["4 5%"], ["12 34"]])("%j is not a number", (raw) => {
    expect(parseNumber(raw)).toBeNull();
  });
});

describe("extractChoice", () => {
  it.each([
    ["B", "B"],
    ["b", "B"],
    ["(C)", "C"],
    ["D.", "D"],
    ["B) the blue one", "B"],
    ["B. the blue one", "B"],
    ["(E) none", "E"],
    ["**B**", "B"],
    ["Answer: C", "C"],
    ["The answer is (D).", "D"],
    ["The correct option is B", "B"],
    ["answer = A", "A"],
  ])("%j -> %s", (raw, want) => {
    expect(extractChoice(raw)).toBe(want);
  });

  it.each([["A cat sits here"], ["F"], [""], ["The answer is Dog"], ["I do not know"], ["B2"]])("%j has no letter", (raw) => {
    expect(extractChoice(raw)).toBeNull();
  });
});

describe("scoreVlm exact", () => {
  it("ignores case, spacing and trailing punctuation", () => {
    expect(scoreVlm("exact", " The  Cat. ", "the cat")).toEqual({ correct: true, score: 1 });
  });
  it("is wrong for a different answer and for an empty one", () => {
    expect(scoreVlm("exact", "dog", "cat")).toEqual({ correct: false, score: 0 });
    expect(scoreVlm("exact", "", "cat").correct).toBe(false);
  });
  it("does not strip leading or inner punctuation", () => {
    expect(scoreVlm("exact", "a.b", "ab").correct).toBe(false);
  });
});

describe("scoreVlm latex", () => {
  it("matches a formula that differs only in spacing and wrapper", () => {
    const s = scoreVlm("latex", "$$ ( 1 - \\Pi ) \\xi = 0 , $$", "(1-\\Pi)\\xi=0,");
    expect(s).toEqual({ correct: true, score: 1, cer: 0 });
  });
  it("matches inside a fenced block", () => {
    expect(scoreVlm("latex", "```latex\n\\frac{a}{b}\n```", "\\frac { a } { b }").correct).toBe(true);
  });
  it("gives the CER of a near miss: one edit over the key length", () => {
    const s = scoreVlm("latex", "\\frac{a}{c}", "\\frac{a}{b}");
    expect(s.correct).toBe(false);
    expect(s.score).toBe(0);
    expect(s.cer).toBeCloseTo(1 / 11, 10);
  });
  it("is CER 1 for an empty answer and can exceed 1 for a long wrong one", () => {
    expect(scoreVlm("latex", "", "abcd").cer).toBe(1);
    expect(scoreVlm("latex", "zzzzzzzz", "ab").cer).toBe(4);
  });
  it("does not divide by zero on an empty key", () => {
    expect(scoreVlm("latex", "x", "").cer).toBe(1);
    expect(scoreVlm("latex", "", "")).toEqual({ correct: true, score: 1, cer: 0 });
  });
  it("is not fooled by a difference in the commands", () => {
    expect(scoreVlm("latex", "\\dfrac{a}{b}", "\\frac{a}{b}").correct).toBe(false);
  });
});

describe("scoreVlm numeric", () => {
  it("accepts a value within 5% of the key, both ways", () => {
    expect(scoreVlm("numeric", "104", "100").correct).toBe(true);
    expect(scoreVlm("numeric", "96", "100").correct).toBe(true);
    expect(scoreVlm("numeric", "105", "100").correct).toBe(true);
    expect(scoreVlm("numeric", "95", "100").correct).toBe(true);
  });
  it("rejects a value beyond 5%", () => {
    expect(scoreVlm("numeric", "106", "100").correct).toBe(false);
    expect(scoreVlm("numeric", "94.9", "100").correct).toBe(false);
  });
  it("uses the size of a negative key", () => {
    expect(scoreVlm("numeric", "-104", "-100").correct).toBe(true);
    expect(scoreVlm("numeric", "-110", "-100").correct).toBe(false);
    expect(scoreVlm("numeric", "100", "-100").correct).toBe(false);
  });
  it("needs an exact match when the key is 0", () => {
    expect(scoreVlm("numeric", "0", "0").correct).toBe(true);
    expect(scoreVlm("numeric", "0.0", "0").correct).toBe(true);
    expect(scoreVlm("numeric", "0.01", "0").correct).toBe(false);
  });
  it("reads %, commas and $", () => {
    expect(scoreVlm("numeric", "34.6%", "34.6").correct).toBe(true);
    expect(scoreVlm("numeric", "$1,200", "1200").correct).toBe(true);
    expect(scoreVlm("numeric", "1,234.5", "1234.5").correct).toBe(true);
  });
  it("tolerates a trailing full stop", () => {
    expect(scoreVlm("numeric", "34.6.", "34.6").correct).toBe(true);
  });
  it("falls back to the normalised text when one side is not a number", () => {
    expect(scoreVlm("numeric", "Yes.", "yes").correct).toBe(true);
    expect(scoreVlm("numeric", "no", "yes").correct).toBe(false);
    expect(scoreVlm("numeric", "about 10", "10").correct).toBe(false);
    expect(scoreVlm("numeric", "12", "twelve").correct).toBe(false);
  });
  it("is wrong for an empty answer", () => {
    expect(scoreVlm("numeric", "", "5").correct).toBe(false);
  });
});

describe("scoreVlm anls", () => {
  it("is 1 for an identical answer (after normalising)", () => {
    expect(scoreVlm("anls", "Hello World.", "hello world")).toEqual({ correct: true, score: 1 });
  });
  it("gives the similarity of a near miss", () => {
    const s = scoreVlm("anls", "helo world", "hello world");
    expect(s.correct).toBe(true);
    expect(s.score).toBeCloseTo(1 - 1 / 11, 10);
  });
  it("is 0 once the normalised distance reaches the 0.5 threshold", () => {
    // distance 2 over length 4 = 0.5 exactly: not below the threshold
    expect(scoreVlm("anls", "abxy", "abcd")).toEqual({ correct: false, score: 0 });
    // distance 1 over length 4 = 0.25
    expect(scoreVlm("anls", "abcx", "abcd").score).toBeCloseTo(0.75, 10);
    expect(scoreVlm("anls", "zzzz", "abcd").score).toBe(0);
  });
  it("handles empty strings", () => {
    expect(scoreVlm("anls", "", "")).toEqual({ correct: true, score: 1 });
    expect(scoreVlm("anls", "", "cat")).toEqual({ correct: false, score: 0 });
  });
});

describe("scoreVlm choice", () => {
  it("compares the letters", () => {
    expect(scoreVlm("choice", "B", "B").correct).toBe(true);
    expect(scoreVlm("choice", "The answer is (B).", "B").correct).toBe(true);
    expect(scoreVlm("choice", "B) blue", "(B)").correct).toBe(true);
    expect(scoreVlm("choice", "C", "B").correct).toBe(false);
  });
  it("is wrong when the answer has no letter", () => {
    expect(scoreVlm("choice", "I am not sure", "B").correct).toBe(false);
    expect(scoreVlm("choice", "", "B").correct).toBe(false);
  });
  it("compares as text when the key is not a letter", () => {
    expect(scoreVlm("choice", "Paris.", "paris").correct).toBe(true);
    expect(scoreVlm("choice", "London", "paris").correct).toBe(false);
  });
});

describe("isVlmScoring", () => {
  it("knows the five modes", () => {
    for (const m of ["exact", "latex", "numeric", "anls", "choice"]) expect(isVlmScoring(m)).toBe(true);
    expect(isVlmScoring("fuzzy")).toBe(false);
    expect(isVlmScoring(undefined)).toBe(false);
  });
});

describe("rateStderr", () => {
  it("is the binomial standard error inside (0, 1)", () => {
    expect(rateStderr(50, 100)).toBeCloseTo(0.05, 10);
  });
  it("is never 0 at 0% or 100%, so an interval still exists", () => {
    expect(rateStderr(10, 10)).toBeGreaterThan(0);
    expect(rateStderr(0, 10)).toBeGreaterThan(0);
    expect(rateStderr(0, 0)).toBe(0);
  });
});

const mk = (id: number, over: Partial<VlmCase> = {}): VlmCase => ({
  id,
  prompt: "p",
  gold: "g",
  pred: "g",
  correct: true,
  score: 1,
  ...over,
});

describe("buildVlmReport", () => {
  it("counts accuracy over the scored rows and gives an interval", () => {
    const cases = [mk(0), mk(1), mk(2, { pred: "x", correct: false, score: 0 }), mk(3)];
    const r = buildVlmReport(cases, "exact");
    expect(r).toMatchObject({ rows: 4, scored: 4, errors: 0, correct: 3, accuracy: 0.75, mode: "exact" });
    expect(r.interval!.low).toBeLessThan(0.75);
    expect(r.interval!.high).toBeGreaterThan(0.75);
    expect(r.interval!.low).toBeGreaterThanOrEqual(0);
    expect(r.interval!.high).toBeLessThanOrEqual(1);
    expect(r.meanCer).toBeUndefined();
  });

  it("leaves failed requests out of the metrics and counts them", () => {
    const cases = [mk(0), mk(1, { pred: "", correct: false, score: 0, error: "engine 500" }), mk(2, { pred: "x", correct: false, score: 0 })];
    const r = buildVlmReport(cases, "exact");
    expect(r).toMatchObject({ rows: 3, scored: 2, errors: 1, correct: 1, accuracy: 0.5 });
    expect(r.empty).toBe(0); // the failed row's empty answer is not an empty ANSWER
  });

  it("has an interval even when every scored row is right", () => {
    const r = buildVlmReport([mk(0), mk(1), mk(2), mk(3), mk(4)], "exact");
    expect(r.accuracy).toBe(1);
    expect(r.interval).not.toBeNull();
    expect(r.interval!.high).toBe(1);
    expect(r.interval!.low).toBeLessThan(1);
  });

  it("is an empty report with no interval for no scored rows", () => {
    const r = buildVlmReport([mk(0, { error: "down", correct: false, score: 0 })], "exact");
    expect(r).toMatchObject({ rows: 1, scored: 0, errors: 1, accuracy: 0, interval: null, meanScore: 0 });
    expect(buildVlmReport([], "exact")).toMatchObject({ rows: 0, scored: 0, accuracy: 0, interval: null });
  });

  it("averages the CER for latex only", () => {
    const cases = [mk(0, { cer: 0 }), mk(1, { cer: 0.5, correct: false, score: 0 }), mk(2, { cer: 1, correct: false, score: 0 })];
    expect(buildVlmReport(cases, "latex").meanCer).toBeCloseTo(0.5, 10);
    expect(buildVlmReport(cases, "exact").meanCer).toBeUndefined();
  });

  it("counts empty and truncated answers among the scored rows", () => {
    const cases = [
      mk(0),
      mk(1, { pred: "  ", correct: false, score: 0 }),
      mk(2, { pred: "", correct: false, score: 0, truncated: true }),
      mk(3, { truncated: true }),
    ];
    const r = buildVlmReport(cases, "exact");
    expect(r.empty).toBe(2);
    expect(r.truncated).toBe(2);
  });

  it("breaks accuracy down per category when rows carry one", () => {
    const cases = [
      mk(0, { category: "bar" }),
      mk(1, { category: "bar", pred: "x", correct: false, score: 0 }),
      mk(2, { category: "line" }),
      mk(3, { category: "line" }),
      mk(4, { category: "line" }),
      mk(5),
    ];
    const r = buildVlmReport(cases, "exact");
    expect(r.categories.map((c) => [c.category, c.n, c.correct])).toEqual([
      ["line", 3, 3],
      ["bar", 2, 1],
      ["(none)", 1, 1],
    ]);
    expect(r.categories[1]!.accuracy).toBe(0.5);
    expect(r.categories[1]!.interval).not.toBeNull();
  });

  it("has no categories when no row carries one", () => {
    expect(buildVlmReport([mk(0), mk(1)], "exact").categories).toEqual([]);
  });

  it("sums tokens and averages latency over what was reported", () => {
    const r = buildVlmReport([mk(0, { tokens: 10, latencyMs: 100 }), mk(1, { tokens: 30, latencyMs: 300 }), mk(2)], "exact");
    expect(r.completionTokens).toBe(40);
    expect(r.meanLatencyMs).toBe(200);
  });

  it("reports the mean score of an ANLS run apart from its accuracy", () => {
    const r = buildVlmReport([mk(0, { score: 1 }), mk(1, { score: 0.5 }), mk(2, { score: 0, correct: false })], "anls");
    expect(r.meanScore).toBeCloseTo(0.5, 10);
    expect(r.accuracy).toBeCloseTo(2 / 3, 10);
  });
});

describe("compareVlmCases", () => {
  const run = (flags: Array<boolean | "err">, cers?: number[]): VlmCase[] =>
    flags.map((f, i) =>
      f === "err"
        ? mk(i, { correct: false, score: 0, error: "x" })
        : mk(i, { correct: f, score: f ? 1 : 0, ...(cers ? { cer: cers[i] } : {}) })
    );

  it("lists the rows that flipped and the accuracy change", () => {
    const a = run([true, false, false, true, false]);
    const b = run([true, true, false, false, true]);
    const c = compareVlmCases(a, b);
    expect(c.paired).toBe(5);
    expect(c.improved).toEqual([1, 4]);
    expect(c.regressed).toEqual([3]);
    expect(c.accA).toBeCloseTo(0.4, 10);
    expect(c.accB).toBeCloseTo(0.6, 10);
    expect(c.delta).toBeCloseTo(0.2, 10);
    expect(c.verdict).toBe("tie"); // five rows cannot tell
  });

  it("calls a big gap on many rows better, and the reverse worse", () => {
    const n = 200;
    const a = run(Array.from({ length: n }, (_, i) => i < 40));
    const b = run(Array.from({ length: n }, (_, i) => i < 160));
    expect(compareVlmCases(a, b).verdict).toBe("better");
    expect(compareVlmCases(b, a).verdict).toBe("worse");
  });

  it("only compares rows scored in both runs", () => {
    const a = run([true, "err", false, true]);
    const b = run([true, true, "err", false]);
    const c = compareVlmCases(a, b);
    expect(c.paired).toBe(2); // ids 0 and 3
    expect(c.regressed).toEqual([3]);
    expect(c.improved).toEqual([]);
  });

  it("matches rows by id, not by position", () => {
    const a = [mk(7, { correct: false, score: 0 }), mk(3)];
    const b = [mk(3), mk(7)];
    const c = compareVlmCases(a, b);
    expect(c.paired).toBe(2);
    expect(c.improved).toEqual([7]);
  });

  it("compares the CER over the paired rows", () => {
    const a = run([false, false], [0.8, 0.6]);
    const b = run([true, false], [0, 0.2]);
    const c = compareVlmCases(a, b);
    expect(c.cerA).toBeCloseTo(0.7, 10);
    expect(c.cerB).toBeCloseTo(0.1, 10);
    expect(c.cerDelta).toBeCloseTo(-0.6, 10);
    expect(compareVlmCases(run([true]), run([true])).cerDelta).toBeUndefined();
  });

  it("is unknown with nothing in common", () => {
    expect(compareVlmCases([], [])).toMatchObject({ paired: 0, verdict: "unknown", delta: 0 });
    expect(compareVlmCases(run(["err"]), run([true]))).toMatchObject({ paired: 0, verdict: "unknown" });
  });
});
