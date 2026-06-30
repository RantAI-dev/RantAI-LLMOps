import { describe, expect, it } from "vitest";

import { assertJobId, assertModelId, assertTag } from "@/lib/validate";

describe("assertJobId", () => {
  it("accepts numeric and UUID-shaped ids", () => {
    expect(() => assertJobId("123")).not.toThrow();
    expect(() => assertJobId("b315392e-63a4-4266-a7e6-d56cb57700cc")).not.toThrow();
  });

  it("rejects traversal / shell / flag-shaped ids", () => {
    for (const bad of ["../etc", "a/b", "a;rm -rf /", "-flag", "a b", "a.b", "$(x)", ""]) {
      expect(() => assertJobId(bad), bad).toThrow();
    }
  });
});

describe("assertModelId", () => {
  it("accepts HF owner/name and bare model ids", () => {
    for (const ok of ["unsloth/Qwen2.5-0.5B-Instruct", "meta-llama/Llama-3.2-1B", "Qwen2.5-0.5B"]) {
      expect(() => assertModelId(ok), ok).not.toThrow();
    }
  });

  it("rejects leading dash, extra slashes, and shell metacharacters", () => {
    for (const bad of ["-bad", "a/b/c", "a b", "a;b", "$(whoami)", "../etc/passwd", "`x`", ""]) {
      expect(() => assertModelId(bad), bad).toThrow();
    }
  });
});

describe("assertTag", () => {
  it("accepts slug-shaped tags", () => {
    for (const ok of ["nqr-foo", "eval-bar_1", "Qwen2.5"]) {
      expect(() => assertTag(ok), ok).not.toThrow();
    }
  });

  it("rejects slashes, spaces, leading dash", () => {
    for (const bad of ["a/b", "a b", "-x", ""]) {
      expect(() => assertTag(bad), bad).toThrow();
    }
  });
});
