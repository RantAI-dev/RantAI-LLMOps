import { describe, expect, it } from "vitest";

import { redactSecrets } from "@/lib/redact";

describe("redactSecrets", () => {
  it("scrubs a long secret value", () => {
    expect(redactSecrets("HF_TOKEN=hf_abcdef123456", ["hf_abcdef123456"])).toBe("HF_TOKEN=***");
  });

  it("scrubs every occurrence", () => {
    expect(redactSecrets("x secret123 y secret123", ["secret123"])).toBe("x *** y ***");
  });

  it("leaves short values (< 6 chars) alone to avoid over-redaction", () => {
    expect(redactSecrets("port=12345", ["12345"])).toBe("port=12345");
  });

  it("ignores undefined / empty secrets", () => {
    expect(redactSecrets("hello world", [undefined, ""])).toBe("hello world");
  });
});
