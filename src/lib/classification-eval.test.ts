import { describe, expect, it } from "vitest";

import {
  UNKNOWN,
  buildClassificationReport,
  deriveLabels,
  parsePrediction,
  scoreClassCase,
} from "@/lib/classification-eval";

describe("classification-eval", () => {
  const labels = ["Emotet", "Mirai"];

  it("parsePrediction matches a known label, else UNKNOWN", () => {
    expect(parsePrediction("Emotet", labels)).toBe("Emotet");
    expect(parsePrediction("Jelas ini Mirai.", labels)).toBe("Mirai");
    expect(parsePrediction("tidak tahu", labels)).toBe(UNKNOWN);
  });

  it("deriveLabels returns distinct, sorted labels", () => {
    expect(
      deriveLabels([
        { instruction: "x", output: "Mirai" },
        { instruction: "y", output: "Emotet" },
        { instruction: "z", output: "Mirai" },
      ])
    ).toEqual(["Emotet", "Mirai"]);
  });

  it("buildClassificationReport computes accuracy, per-class, confusion, and unknowns", () => {
    const cases = [
      scoreClassCase({ instruction: "a", output: "Emotet" }, "Emotet", labels), // correct
      scoreClassCase({ instruction: "b", output: "Emotet" }, "Mirai", labels), // wrong
      scoreClassCase({ instruction: "c", output: "Mirai" }, "Mirai", labels), // correct
      scoreClassCase({ instruction: "d", output: "Mirai" }, "tidak tahu", labels), // UNKNOWN
    ];
    const r = buildClassificationReport(cases, labels);
    expect(r.total).toBe(4);
    expect(r.accuracy).toBeCloseTo(0.5, 5);
    expect(r.unknownCount).toBe(1);
    // rows = true [Emotet, Mirai], cols = predicted
    expect(r.confusion).toEqual([
      [1, 1],
      [0, 1],
    ]);
    expect(r.perClass.Emotet.precision).toBeCloseTo(1, 5);
    expect(r.perClass.Emotet.recall).toBeCloseTo(0.5, 5);
    expect(r.perClass.Mirai.precision).toBeCloseTo(0.5, 5);
    expect(r.perClass.Mirai.recall).toBeCloseTo(0.5, 5);
    expect(r.macroF1).toBeCloseTo(0.5833, 3);
  });
});
