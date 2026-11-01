import { describe, expect, it } from "vitest";

import { parseLoss } from "@/modules/finetune/lib/parse-loss";
import { parseDecisionReport } from "@/modules/finetune/lib/parse-decision";

const LINE =
  'DECISION_REPORT {"before": {"accuracy": 0.4917, "ece": 0.0979, "record_accuracy": 0.0625}, "after": {"accuracy": 1.0, "ece": 0.0, "record_accuracy": 1.0}, "test_set": "eval.jsonl"}';

describe("parseDecisionReport", () => {
  it("reads before, after and the test set from the summary line", () => {
    expect(parseDecisionReport(`noise\n${LINE}\nTraining result: {}`)).toEqual({
      before: { accuracy: 0.4917, ece: 0.0979, record_accuracy: 0.0625 },
      after: { accuracy: 1, ece: 0, record_accuracy: 1 },
      testSet: "eval.jsonl",
      exports: {},
    });
  });

  it("reads the test size, truncation and export statuses of a newer report", () => {
    const line =
      'DECISION_REPORT {"before": {}, "after": {"accuracy": 0.7}, "test_set": "holdout", "test_items": 12, ' +
      '"truncated": 3, "skipped": 0, "exports": {"merged": "saved", "gguf": "failed", "bad": 5}}';
    expect(parseDecisionReport(line)).toMatchObject({
      testItems: 12,
      truncated: 3,
      exports: { merged: "saved", gguf: "failed" },
    });
  });

  it("finds the line after a tqdm progress bar on the same carriage-return segment", () => {
    expect(parseDecisionReport(`  97%|#########| 70/72 [01:03]\r${LINE}`)?.after.accuracy).toBe(1);
  });

  it("takes the last report when there are several", () => {
    const second = LINE.replace('"accuracy": 1.0', '"accuracy": 0.9');
    expect(parseDecisionReport(`${LINE}\n${second}`)?.after.accuracy).toBe(0.9);
  });

  it("returns null when there is no line, or it is not JSON", () => {
    expect(parseDecisionReport("")).toBeNull();
    expect(parseDecisionReport("DECISION_REPORT {broken")).toBeNull();
  });

  it("drops non-numeric metrics and defaults the test set", () => {
    const r = parseDecisionReport('DECISION_REPORT {"before": {"accuracy": "x"}, "after": {"ece": 0.1}}');
    expect(r).toEqual({ before: {}, after: { ece: 0.1 }, testSet: "holdout", exports: {} });
  });

  it("is not read as a training-loss point by the loss parser", () => {
    expect(parseLoss(LINE)).toEqual([]);
  });
});
