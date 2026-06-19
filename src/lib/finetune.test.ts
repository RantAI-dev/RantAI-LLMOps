import { describe, expect, it } from "vitest";

import { buildFormattingTemplate } from "@/lib/finetune";

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
