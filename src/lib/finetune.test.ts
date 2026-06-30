import { describe, expect, it } from "vitest";

import { buildFormattingTemplate, fineTuneTag } from "@/lib/finetune";

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

  it("always carries one nqr- prefix and a slugified name", () => {
    expect(fineTuneTag("My Run", "42")).toBe("nqr-my-run-42");
    expect(fineTuneTag("nqr-already", "7")).toBe("nqr-already-7");
  });
});
