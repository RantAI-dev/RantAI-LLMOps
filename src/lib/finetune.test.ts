import { describe, expect, it } from "vitest";

import {
  buildDecisionParameters,
  buildFormattingTemplate,
  csvToJsonl,
  fineTuneTag,
  isDecisionJob,
  normalizeJsonl,
  type SubmitFinetuneParams,
} from "@/lib/finetune";

describe("buildFormattingTemplate", () => {
  it("uses the Alpaca shape for instruction/input/output", () => {
    const t = buildFormattingTemplate(["instruction", "input", "output"]);
    expect(t).toContain("{{instruction}}");
    expect(t).toContain("{{input}}");
    expect(t).toContain("{{output}}");
  });

  it("omits input when absent", () => {
    const t = buildFormattingTemplate(["instruction", "output"]);
    expect(t).toContain("{{instruction}}");
    expect(t).not.toContain("{{input}}");
  });

  it("handles prompt/completion datasets", () => {
    expect(buildFormattingTemplate(["prompt", "completion"])).toBe(
      "### Question:\n{{prompt}}\n\n### Answer:\n{{completion}}"
    );
  });

  it("passes a plain text column straight through", () => {
    expect(buildFormattingTemplate(["text"])).toBe("{{text}}");
  });

  it("falls back to joining unknown columns", () => {
    expect(buildFormattingTemplate(["a", "b"])).toBe("{{a}}\n{{b}}");
  });
});

describe("fineTuneTag", () => {
  it("disambiguates same-named runs by job id (no collision)", () => {
    expect(fineTuneTag("My Run", "1")).not.toBe(fineTuneTag("My Run", "2"));
  });

  it("is stable for the same name + job id (listing must match export)", () => {
    expect(fineTuneTag("My Run", "42")).toBe(fineTuneTag("My Run", "42"));
  });

  it("always carries one rantai- prefix and a slugified name", () => {
    expect(fineTuneTag("My Run", "42")).toBe("rantai-my-run-42");
    // A leading brand prefix in the name (new or legacy) isn't doubled up.
    expect(fineTuneTag("rantai-already", "7")).toBe("rantai-already-7");
    expect(fineTuneTag("nqr-already", "7")).toBe("rantai-already-7");
  });
});

describe("csvToJsonl", () => {
  it("maps header row to JSON object keys per data row", () => {
    const out = csvToJsonl("question,answer\nApa ibukota Jepang?,Tokyo\nWarna langit?,Biru");
    expect(out.split("\n")).toEqual([
      '{"question":"Apa ibukota Jepang?","answer":"Tokyo"}',
      '{"question":"Warna langit?","answer":"Biru"}',
    ]);
  });

  it("handles quoted fields with commas, escaped quotes, and CRLF", () => {
    const out = csvToJsonl('a,b\r\n"x,y","he said ""hi"""\r\n');
    expect(out).toBe('{"a":"x,y","b":"he said \\"hi\\""}');
  });

  it("pads ragged rows with empty strings", () => {
    expect(csvToJsonl("a,b,c\n1,2")).toBe('{"a":"1","b":"2","c":""}');
  });

  it("rejects a header-only file, empty/duplicate headers, and over-wide rows", () => {
    expect(() => csvToJsonl("a,b")).toThrow(); // header only
    expect(() => csvToJsonl("a,,c\n1,2,3")).toThrow(); // empty header column
    expect(() => csvToJsonl("a,a\n1,2")).toThrow(/duplicate/); // duplicate header
    expect(() => csvToJsonl("a,b\n1,2,3")).toThrow(); // row wider than header
  });
});

describe("normalizeJsonl", () => {
  it("keeps valid object lines and drops blank lines", () => {
    expect(normalizeJsonl('{"a":1}\n\n{"b":2}\n')).toBe('{"a":1}\n{"b":2}');
  });

  it("rejects a non-JSON line with its REAL file line number (blank lines counted)", () => {
    expect(() => normalizeJsonl('{"a":1}\nnope')).toThrow(/Row 2/);
    // Blank line 2 is skipped but still counted, so the bad line is 3 — not 2.
    expect(() => normalizeJsonl('{"a":1}\n\nnope')).toThrow(/Row 3/);
  });

  it("rejects lines that aren't JSON objects", () => {
    expect(() => normalizeJsonl("[1,2,3]")).toThrow();
    expect(() => normalizeJsonl("42")).toThrow();
  });

  it("rejects an empty file", () => {
    expect(() => normalizeJsonl("   \n  ")).toThrow();
  });
});

describe("buildDecisionParameters", () => {
  const base: SubmitFinetuneParams = {
    baseModel: "unsloth/Qwen3.5-2B",
    dataset: "s3://corpus/decisions/tiket/",
    adaptorName: "tiket-router",
    method: "decision",
  };

  it("uses the decision trainer's defaults, not the SFT ones", () => {
    const p = buildDecisionParameters(base);
    expect(p).toMatchObject({
      model_name: "unsloth/Qwen3.5-2B",
      dataset: "s3://corpus/decisions/tiket/",
      lr: 0.0001, // SFT starts at 2e-4
      head_lr: 0.0003,
      max_seq_length: 4096, // 150-option questions do not fit in 2048
      lora_r: 64,
      lora_alpha: 64, // follows lora_r when not given
      load_in_4bit: false,
      holdout_fraction: 0.1,
      save_merged: false,
      export_gguf: false,
    });
  });

  it("trains the full epochs unless the caller caps the steps", () => {
    expect(buildDecisionParameters(base).max_steps).toBe(-1);
    expect(buildDecisionParameters({ ...base, maxSteps: 30 }).max_steps).toBe(30);
  });

  it("passes overrides through and keeps lora_alpha tied to a changed lora_r", () => {
    const p = buildDecisionParameters({
      ...base,
      loraR: 16,
      learningRate: 0.0002,
      headLearningRate: 0.001,
      headWarmupSteps: 20,
      holdoutFraction: 0.2,
      loadIn4bit: true,
      exportGguf: true,
      gradientAccumulationSteps: 2,
    });
    expect(p).toMatchObject({
      lora_r: 16,
      lora_alpha: 16,
      lr: 0.0002,
      head_lr: 0.001,
      head_warmup_steps: 20,
      holdout_fraction: 0.2,
      load_in_4bit: true,
      export_gguf: true,
      gradient_accumulation_steps: 2,
    });
  });
});

describe("isDecisionJob", () => {
  it("recognises the DECISION subtype and the decision trainer command", () => {
    expect(isDecisionJob({ job_data: { subtype: "DECISION" } })).toBe(true);
    expect(isDecisionJob({ job_data: { run: "python unsloth-decision-train/train.py" } })).toBe(true);
  });

  it("does not claim SFT, eval or empty jobs", () => {
    expect(isDecisionJob({ job_data: { subtype: "TRAIN", run: "python unsloth-llm-train/train.py" } })).toBe(false);
    expect(isDecisionJob({ job_data: { subtype: "EVAL" } })).toBe(false);
    expect(isDecisionJob({})).toBe(false);
  });
});
