import { describe, expect, it } from "vitest";

import { parseEvalLoss, parseLoss } from "@/modules/finetune/lib/parse-loss";

// Mimics the raw HF/Unsloth trainer stdout captured in provider_logs: the
// default dict print for training steps and evaluation steps, plus the
// human-readable `Step N: loss=...` line the LabCallback adds (which must NOT
// be double-counted).
const log = `
{'loss': 0.5432, 'grad_norm': 1.2, 'learning_rate': 0.0002, 'epoch': 0.5}
Step 1: loss=0.5432
{'loss': 0.4310, 'grad_norm': 0.9, 'epoch': 1.0}
{'eval_loss': 0.4821, 'eval_runtime': 3.2, 'eval_samples_per_second': 40.0, 'epoch': 1.0}
{'loss': 0.3122, 'epoch': 1.5}
{'eval_loss': 0.3999, 'epoch': 2.0}
`;

describe("parse-loss", () => {
  it("parseLoss extracts training loss only (ignores eval_loss and the Step line)", () => {
    expect(parseLoss(log)).toEqual([0.5432, 0.431, 0.3122]);
  });

  it("parseEvalLoss extracts eval loss only", () => {
    expect(parseEvalLoss(log)).toEqual([0.4821, 0.3999]);
  });

  it("does not cross-contaminate the two series", () => {
    expect(parseLoss("{'eval_loss': 0.9}")).toEqual([]);
    expect(parseEvalLoss("{'loss': 0.9}")).toEqual([]);
  });
});
