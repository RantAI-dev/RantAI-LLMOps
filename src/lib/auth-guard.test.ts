// @vitest-environment node
import { describe, expect, it } from "vitest";

import { crossOriginWrite } from "@/lib/auth";
import { decisionParamProblems } from "@/lib/decision-schema";

const req = (method: string, headers: Record<string, string>) => new Request("http://10.0.0.1:3000/api/x", { method, headers });

describe("crossOriginWrite", () => {
  it("refuses a write from another app on the same host but another port", () => {
    expect(crossOriginWrite(req("POST", { host: "10.0.0.1:3000", origin: "http://10.0.0.1:3090" }))).toBe(true);
    expect(crossOriginWrite(req("DELETE", { host: "10.0.0.1:3000", origin: "http://evil.example" }))).toBe(true);
  });

  it("allows same-origin writes, reads, and requests without an Origin (curl, server-to-server)", () => {
    expect(crossOriginWrite(req("POST", { host: "10.0.0.1:3000", origin: "http://10.0.0.1:3000" }))).toBe(false);
    expect(crossOriginWrite(req("GET", { host: "10.0.0.1:3000", origin: "http://evil.example" }))).toBe(false);
    expect(crossOriginWrite(req("POST", { host: "10.0.0.1:3000" }))).toBe(false);
    expect(crossOriginWrite(req("POST", { host: "internal:3000", "x-forwarded-host": "llmops.example", origin: "https://llmops.example" }))).toBe(false);
  });
});

describe("decisionParamProblems (twin of param_problems in decision_schema.py)", () => {
  it("accepts sensible settings and refuses ones that train nothing or wrongly", () => {
    expect(decisionParamProblems({ lr: 1e-4, num_train_epochs: 1, holdout_fraction: 0.1, batch_size: 4 })).toEqual([]);
    expect(decisionParamProblems({ num_train_epochs: 0, max_steps: -1 })).not.toEqual([]);
    expect(decisionParamProblems({ num_train_epochs: 0, max_steps: 50 })).toEqual([]);
    for (const bad of [{ lr: -1 }, { lr: 0 }, { head_lr: -0.1 }, { holdout_fraction: 1 }, { holdout_fraction: 0 }, { batch_size: 0 }, { max_seq_length: 10 }, { lora_dropout: 1 }, { lr: "abc" }, { lr: true }]) {
      expect(decisionParamProblems(bad), JSON.stringify(bad)).not.toEqual([]);
    }
  });
});
