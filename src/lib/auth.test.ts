import { describe, expect, it } from "vitest";

import { constantTimeEqual, sessionToken, verifySession } from "@/lib/auth";

describe("constantTimeEqual", () => {
  it("is true for identical strings", () => {
    expect(constantTimeEqual("abc123", "abc123")).toBe(true);
    expect(constantTimeEqual("", "")).toBe(true);
  });

  it("is false for same-length but different strings", () => {
    expect(constantTimeEqual("abc", "abd")).toBe(false);
  });

  it("is false for different-length strings", () => {
    expect(constantTimeEqual("ab", "abc")).toBe(false);
  });
});

describe("sessionToken", () => {
  it("is a 64-char lowercase hex SHA-256 digest", async () => {
    expect(await sessionToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for a fixed secret + password", async () => {
    expect(await sessionToken()).toBe(await sessionToken());
  });
});

describe("verifySession", () => {
  it("accepts the current token", async () => {
    expect(await verifySession(await sessionToken())).toBe(true);
  });

  it("rejects a missing or wrong cookie", async () => {
    expect(await verifySession(undefined)).toBe(false);
    expect(await verifySession("deadbeef")).toBe(false);
  });
});
