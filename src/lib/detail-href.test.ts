import { describe, expect, it } from "vitest";

import { decodeDetailId, detailHref, encodeDetailId } from "@/lib/detail-href";

describe("detail-href", () => {
  const ids = [
    "s3://corpus/", // folder ref — "//" + trailing "/" broke the old per-segment scheme
    "s3://bucket/path/file.jsonl",
    "s3://datasets/corpusB/other-set/train.jsonl",
    "Trelis/touch-rugby-rules", // HF repo id
    "qwen:0.5b", // Ollama tag
    "plain-id",
  ];

  it("round-trips every id through encode → decode", () => {
    for (const id of ids) {
      expect(decodeDetailId(encodeDetailId(id))).toBe(id);
    }
  });

  it("encodes to a single slash-free path segment", () => {
    for (const id of ids) {
      expect(encodeDetailId(id)).not.toContain("/");
    }
  });

  it("builds a detail href the catch-all route can reassemble", () => {
    const href = detailHref("/datasets", "s3://corpus/");
    expect(href.startsWith("/datasets/")).toBe(true);
    const segment = href.slice("/datasets/".length);
    expect(segment).not.toContain("/"); // survives router path parsing intact
    expect(decodeDetailId(segment)).toBe("s3://corpus/");
  });
});
