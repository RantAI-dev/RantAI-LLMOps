import { describe, expect, it } from "vitest";

import { parseChatSseLine } from "@/modules/playground/lib/sse";

describe("parseChatSseLine", () => {
  it("extracts the content delta from a data line", () => {
    const line = 'data: {"choices":[{"delta":{"content":"Hello"}}]}';
    expect(parseChatSseLine(line)).toBe("Hello");
  });

  it("returns null for the [DONE] sentinel and empty/keep-alive lines", () => {
    expect(parseChatSseLine("data: [DONE]")).toBeNull();
    expect(parseChatSseLine("data:")).toBeNull();
    expect(parseChatSseLine(": keep-alive")).toBeNull();
    expect(parseChatSseLine("")).toBeNull();
  });

  it("returns null for non-data lines and a delta with no content (e.g. role chunk)", () => {
    expect(parseChatSseLine("event: message")).toBeNull();
    expect(parseChatSseLine('data: {"choices":[{"delta":{"role":"assistant"}}]}')).toBeNull();
  });

  it("returns null (does not throw) on malformed JSON", () => {
    expect(parseChatSseLine("data: {not json")).toBeNull();
  });
});
