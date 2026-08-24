import { describe, expect, it } from "vitest";

import { lineDiff } from "@/modules/prompts/lib/diff";

describe("lineDiff", () => {
  it("marks unchanged text as all 'same'", () => {
    expect(lineDiff("a\nb", "a\nb").every((l) => l.type === "same")).toBe(true);
  });

  it("marks an appended line as 'add'", () => {
    expect(lineDiff("a\nb", "a\nb\nc")).toContainEqual({ type: "add", text: "c" });
  });

  it("marks a removed line as 'del'", () => {
    expect(lineDiff("a\nb\nc", "a\nc")).toContainEqual({ type: "del", text: "b" });
  });

  it("shows a changed line as a del + an add", () => {
    const d = lineDiff("hello world", "hello there");
    expect(d.some((l) => l.type === "del" && l.text === "hello world")).toBe(true);
    expect(d.some((l) => l.type === "add" && l.text === "hello there")).toBe(true);
  });

  it("keeps common lines around an edit", () => {
    const d = lineDiff("intro\nbody v1\noutro", "intro\nbody v2\noutro");
    expect(d.filter((l) => l.type === "same").map((l) => l.text)).toEqual(["intro", "outro"]);
  });
});
