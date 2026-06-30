import { describe, expect, it } from "vitest";

import { unwrapList } from "@/lib/tl-fetch";

describe("unwrapList", () => {
  it("returns a bare array unchanged", () => {
    expect(unwrapList([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it("unwraps the { data: [...] } envelope", () => {
    expect(unwrapList({ data: ["a", "b"] })).toEqual(["a", "b"]);
  });

  it("falls back to [] for null, plain objects, and non-array `data`", () => {
    expect(unwrapList(null)).toEqual([]);
    expect(unwrapList(undefined)).toEqual([]);
    expect(unwrapList({})).toEqual([]);
    expect(unwrapList({ data: "nope" })).toEqual([]);
  });
});
