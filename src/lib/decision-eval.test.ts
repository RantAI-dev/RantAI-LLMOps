import { describe, expect, it } from "vitest";

import {
  buildDecisionReport,
  calibration,
  coverageAtAccuracy,
  extractPrediction,
  goldLabel,
  parseDecisionEvalSet,
  scoreDecisionCase,
  type DecisionCase,
  type QuestionMeta,
} from "@/lib/decision-eval";

const row = (state: string, gold: Record<string, unknown>) =>
  JSON.stringify({
    state,
    questions: {
      team: { type: "choice", criteria: { billing: "tagihan", technical: "teknis", sales: "penawaran" } },
      refund: { type: "noul" },
      urgency: { type: "score", criteria: ["rendah", "sedang", "tinggi", "kritis"] },
    },
    gold,
  });

describe("goldLabel", () => {
  const opts = ["billing", "technical", "sales"];
  it("reads hard labels and the strongest of soft ones", () => {
    expect(goldLabel("choice", opts, "billing")).toBe("billing");
    expect(goldLabel("choice", opts, { label: "sales" })).toBe("sales");
    expect(goldLabel("choice", opts, { probabilities: { billing: 0.1, technical: 0.7, sales: 0.2 } })).toBe("technical");
    expect(goldLabel("noul", [], true)).toBe("true");
    expect(goldLabel("noul", [], "FALSE")).toBe("false");
    expect(goldLabel("noul", [], { noul: 0.8 })).toBe("true");
    expect(goldLabel("noul", [], { noul: 0.2 })).toBe("false");
    expect(goldLabel("noul", [], { probabilities: { true: 0.3, false: 0.7 } })).toBe("false");
    expect(goldLabel("score", ["0", "1", "2"], 2)).toBe("2");
    expect(goldLabel("score", ["0", "1", "2"], { probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 } })).toBe("2");
  });
  it("returns null for a gold it cannot use", () => {
    expect(goldLabel("noul", [], "maybe")).toBeNull();
    expect(goldLabel("choice", opts, { probabilities: {} })).toBeNull();
  });
});

describe("extractPrediction (the server's answer shapes)", () => {
  it("reads choice, noul and score answers", () => {
    const c = extractPrediction("choice", ["a", "b"], { type: "choice", choice: "b", probabilities: { a: 0.2, b: 0.8 } });
    expect(c).toMatchObject({ label: "b", probs: { a: 0.2, b: 0.8 } });
    const n = extractPrediction("noul", [], { type: "noul", noul: 0.9, answer: true, probabilities: { true: 0.9, false: 0.1 } });
    expect(n?.label).toBe("true");
    expect(n?.probs.false).toBeCloseTo(0.1);
    const s = extractPrediction("score", ["0", "1", "2"], { type: "score", score: 1.7, answer: 2, probabilities: { "0": 0.05, "1": 0.25, "2": 0.7 } });
    expect(s).toMatchObject({ label: "2", score: 1.7 });
  });
  it("falls back to the strongest probability and rejects an answer without any", () => {
    expect(extractPrediction("choice", ["a", "b"], { probabilities: { a: 0.6, b: 0.4 } })?.label).toBe("a");
    expect(extractPrediction("choice", ["a", "b"], { type: "choice" })).toBeNull();
    expect(extractPrediction("noul", [], {})).toBeNull();
    expect(extractPrediction("noul", [], null)).toBeNull();
  });
});

describe("calibration", () => {
  it("matches a hand computation (ECE 0.25)", () => {
    // 0.6 wrong -> bin [0.6,0.7): |0-0.6|/4 = 0.15 ; 0.8 right -> |1-0.8|/4 = 0.05 ; two 0.9 right -> 2*0.1/4 = 0.05
    const pts = [
      { conf: 0.9, correct: true },
      { conf: 0.8, correct: true },
      { conf: 0.6, correct: false },
      { conf: 0.9, correct: true },
    ];
    const { ece, bins } = calibration(pts);
    expect(ece).toBeCloseTo(0.25, 10);
    expect(bins[9]).toMatchObject({ count: 2, accuracy: 1 });
    expect(bins[9]!.confidence).toBeCloseTo(0.9, 10);
    expect(bins.reduce((n, b) => n + b.count, 0)).toBe(4);
  });
  it("puts a confidence of exactly 1 in the last bin", () => {
    expect(calibration([{ conf: 1, correct: true }]).bins[9]!.count).toBe(1);
  });
  it("is zero for a perfectly calibrated sample and for no data", () => {
    expect(calibration([]).ece).toBe(0);
    const pts = [...Array(8).fill({ conf: 0.8, correct: true }), ...Array(2).fill({ conf: 0.8, correct: false })];
    expect(calibration(pts).ece).toBeCloseTo(0, 10);
  });
});

describe("coverageAtAccuracy (the automation question)", () => {
  const pts = [
    { conf: 0.99, correct: true },
    { conf: 0.95, correct: true },
    { conf: 0.9, correct: true },
    { conf: 0.7, correct: false },
    { conf: 0.6, correct: true },
  ];
  it("finds the largest share that still meets the target", () => {
    expect(coverageAtAccuracy(pts, 0.95)).toBeCloseTo(3 / 5); // top 3 are all right; adding the 0.7 miss drops to 75%
    expect(coverageAtAccuracy(pts, 0.75)).toBeCloseTo(1); // all five: 4/5 = 80% >= 75%
  });
  it("is null when even the most confident decision misses the target", () => {
    expect(coverageAtAccuracy([{ conf: 0.9, correct: false }], 0.9)).toBeNull();
  });
  it("never cuts inside a tie", () => {
    const tied = [
      { conf: 0.9, correct: true },
      { conf: 0.8, correct: true },
      { conf: 0.8, correct: false },
    ];
    expect(coverageAtAccuracy(tied, 1)).toBeCloseTo(1 / 3); // 2/3 of a tied pair is not a threshold anyone can apply
  });
});

describe("parseDecisionEvalSet", () => {
  it("keeps valid rows, counts the rest, and unions the options per question", () => {
    const jsonl = [
      row("a", { team: "billing", refund: true, urgency: 2 }),
      "not json",
      JSON.stringify({ state: "x", questions: { team: { type: "choice", criteria: { billing: "b", legal: "l" } } }, gold: { team: "legal" } }),
      JSON.stringify({ state: "", questions: {}, gold: {} }),
    ].join("\n");
    const p = parseDecisionEvalSet(jsonl);
    expect(p.rows).toHaveLength(2);
    expect(p.invalid).toBe(2);
    expect(p.errors).toHaveLength(2);
    expect(p.meta.team!.options).toEqual(["billing", "technical", "sales", "legal"]);
    expect(p.meta.urgency).toEqual({ type: "score", options: ["0", "1", "2", "3"] });
  });
  it("accepts rows whose questions and gold are JSON strings (Hugging Face exports)", () => {
    const p = parseDecisionEvalSet(
      JSON.stringify({ state: "s", questions: JSON.stringify({ q: { type: "noul" } }), gold: JSON.stringify({ q: { noul: 0.9 } }) })
    );
    expect(p.rows).toHaveLength(1);
  });
});

describe("buildDecisionReport", () => {
  const meta: Record<string, QuestionMeta> = {
    team: { type: "choice", options: ["billing", "technical", "sales"] },
    refund: { type: "noul", options: ["false", "true"] },
    urgency: { type: "score", options: ["0", "1", "2", "3"] },
  };
  const p = parseDecisionEvalSet(
    [
      row("r1", { team: "billing", refund: true, urgency: 2 }),
      row("r2", { team: "technical", refund: false, urgency: 0 }),
      row("r3", { team: "sales", refund: false, urgency: 3 }),
      row("r4", { team: "billing", refund: true, urgency: 1 }),
    ].join("\n")
  );
  const ans = (team: [string, number], refund: number, urgency: number) => ({
    team: { type: "choice", choice: team[0], probabilities: { [team[0]]: team[1], other: 1 - team[1] } },
    refund: { type: "noul", noul: refund, answer: refund >= 0.5, probabilities: { true: refund, false: 1 - refund } },
    urgency: { type: "score", answer: urgency, score: urgency, probabilities: { [String(urgency)]: 0.8 } },
  });
  const cases: DecisionCase[] = [
    scoreDecisionCase(0, p.rows[0]!, ans(["billing", 0.9], 0.9, 2), meta), // team ok, refund ok, urgency ok
    scoreDecisionCase(1, p.rows[1]!, ans(["technical", 0.8], 0.2, 1), meta), // team ok, refund ok, urgency off by 1
    scoreDecisionCase(2, p.rows[2]!, ans(["billing", 0.6], 0.3, 3), meta), // team WRONG (sales), refund ok, urgency ok
    scoreDecisionCase(3, p.rows[3]!, ans(["billing", 0.9], 0.4, 3), meta), // team ok, refund WRONG, urgency off by 2
  ];
  const report = buildDecisionReport(cases, meta);

  it("counts rows and decisions", () => {
    expect(report.rows).toBe(4);
    expect(report.scoredRows).toBe(4);
    expect(report.decisions).toBe(12);
  });

  it("scores each question", () => {
    const q = Object.fromEntries(report.questions.map((x) => [x.name, x]));
    expect(q.team!.accuracy).toBeCloseTo(3 / 4);
    expect(q.refund!.accuracy).toBeCloseTo(3 / 4);
    expect(q.urgency!.accuracy).toBeCloseTo(2 / 4);
    expect(q.urgency!.mae).toBeCloseTo((0 + 1 + 0 + 2) / 4);
    expect(q.urgency!.within1).toBeCloseTo(3 / 4);
    expect(q.refund!.positiveRate).toBeCloseTo(2 / 4);
    expect(q.team!.confusion!.sales).toEqual({ billing: 1 }); // the miss: truth sales, said billing
    expect(q.team!.perClass!.billing).toMatchObject({ support: 2 });
    expect(q.team!.perClass!.billing!.precision).toBeCloseTo(2 / 3); // said billing 3 times, 2 right
    expect(q.team!.perClass!.billing!.recall).toBeCloseTo(1);
    expect(q.team!.perClass!.sales).toMatchObject({ precision: 0, recall: 0, f1: 0 });
  });

  it("pools accuracy, macro accuracy and all-correct rows", () => {
    expect(report.accuracy).toBeCloseTo(8 / 12);
    expect(report.macroAccuracy).toBeCloseTo((3 / 4 + 3 / 4 + 2 / 4) / 3);
    expect(report.recordAccuracy).toBeCloseTo(1 / 4); // only row 0 has every answer right
  });

  it("reports an automation curve that never grows with the threshold", () => {
    const cov = report.automation.map((a) => a.coverage);
    for (let i = 1; i < cov.length; i++) expect(cov[i]!).toBeLessThanOrEqual(cov[i - 1]!);
    expect(report.automation[0]!.threshold).toBe(0.5);
    expect(report.automation[0]!.coverage).toBeGreaterThan(0);
  });

  it("keeps log loss and Brier finite and ordered sensibly", () => {
    expect(report.logLoss).toBeGreaterThan(0);
    expect(Number.isFinite(report.logLoss)).toBe(true);
    expect(report.brier).toBeGreaterThan(0);
    expect(report.brier).toBeLessThan(2);
  });

  it("excludes failed rows from the metrics but not from the row count", () => {
    const failed: DecisionCase = { i: 9, state: "x", results: {}, error: "timeout" };
    const r = buildDecisionReport([...cases, failed], meta, 5);
    expect(r.rows).toBe(5);
    expect(r.scoredRows).toBe(4);
    expect(r.accuracy).toBeCloseTo(report.accuracy);
  });

  it("survives an empty run", () => {
    const r = buildDecisionReport([], meta, 0);
    expect(r).toMatchObject({ decisions: 0, accuracy: 0, ece: 0, coverageAt95: null });
    expect(r.questions).toEqual([]);
  });
});

describe("an unanswered question", () => {
  const meta: Record<string, QuestionMeta> = {
    team: { type: "choice", options: ["billing", "technical"] },
    refund: { type: "noul", options: ["false", "true"] },
  };
  it("keeps the row from counting as fully right", () => {
    const p = parseDecisionEvalSet(
      JSON.stringify({
        state: "s",
        questions: { team: { type: "choice", criteria: { billing: "b", technical: "t" } }, refund: { type: "noul" } },
        gold: { team: "billing", refund: true },
      })
    );
    // team is answered and right; refund has no usable answer
    const c = scoreDecisionCase(0, p.rows[0]!, { team: { type: "choice", choice: "billing", probabilities: { billing: 0.9, technical: 0.1 } } }, meta);
    expect(c.unanswered).toBe(1);
    expect(buildDecisionReport([c], meta, 1).recordAccuracy).toBe(0);
  });
});
