import { describe, expect, it } from "vitest";

import {
  DatasetInputError,
  buildTextReport,
  detectFormat,
  detectTextSchema,
  jsonArrayToJsonl,
  pairsToJsonl,
  toJsonl,
} from "@/lib/dataset-ingest";

describe("detectFormat", () => {
  it("trusts the file extension first", () => {
    expect(detectFormat("a.csv", "{}")).toBe("csv");
    expect(detectFormat("a.JSONL", "[1]")).toBe("jsonl");
    expect(detectFormat("a.ndjson", "")).toBe("jsonl");
  });
  it("sniffs pasted text and extensionless names", () => {
    expect(detectFormat("", '[{"a":1}]')).toBe("json");
    expect(detectFormat("", '{"a":1}\n{"a":2}')).toBe("jsonl");
    expect(detectFormat("", "Apa itu RAG? | Retrieval-augmented generation")).toBe("pairs");
    expect(detectFormat("notes.json", "plain")).toBe("json");
    expect(detectFormat("", "just words")).toBe("jsonl"); // the strict JSONL check then explains what is wrong
  });
  it("does not mistake a pipe inside a JSON line for the pairs format", () => {
    expect(detectFormat("", '{"prompt":"a | b","completion":"c"}')).toBe("jsonl");
  });
});

describe("toJsonl", () => {
  it("converts every supported format to JSONL", () => {
    expect(toJsonl("q,a\nx,y\n", "d.csv")).toEqual({ jsonl: '{"q":"x","a":"y"}', format: "csv" });
    expect(toJsonl('[{"a":1},{"a":2}]', "d.json").jsonl).toBe('{"a":1}\n{"a":2}');
    expect(toJsonl("hi | hello\nbye | goodbye", "").jsonl).toBe(
      '{"prompt":"hi","completion":"hello"}\n{"prompt":"bye","completion":"goodbye"}'
    );
    expect(toJsonl('{"a":1}\n\n{"a":2}\n', "d.jsonl").jsonl).toBe('{"a":1}\n{"a":2}');
  });
  it("drops a UTF-8 BOM", () => {
    expect(toJsonl("﻿q,a\nx,y", "d.csv").jsonl).toBe('{"q":"x","a":"y"}');
  });
  it("names the problem instead of storing something half-broken", () => {
    expect(() => toJsonl('{"a":1}\nnope', "d.jsonl")).toThrow(/Row 2/);
    expect(() => toJsonl("[1,2]", "d.json")).toThrow(/Item 1/);
    expect(() => toJsonl('{"a":', "d.json")).toThrow(/not valid JSON/);
    expect(() => toJsonl("a,b", "d.csv")).toThrow(DatasetInputError);
    expect(() => pairsToJsonl("no separator here")).toThrow(/prompt \| completion/);
    expect(() => jsonArrayToJsonl("[]")).toThrow(/non-empty/);
  });
  it("skips pair lines that lack one half", () => {
    expect(pairsToJsonl("a | b\nonly-a |\n| only-b\nc | d").split("\n")).toHaveLength(2);
  });
});

describe("detectTextSchema", () => {
  it("mirrors the layouts the trainer's template understands", () => {
    expect(detectTextSchema(["instruction", "input", "output"])).toMatchObject({ id: "instruction-output", recognised: true });
    expect(detectTextSchema(["prompt", "completion"]).id).toBe("prompt-completion");
    expect(detectTextSchema(["question", "answer", "id"]).id).toBe("question-answer");
    expect(detectTextSchema(["text"]).id).toBe("text");
    expect(detectTextSchema(["a", "b"])).toMatchObject({ id: "none", recognised: false });
  });
});

describe("buildTextReport (the review step)", () => {
  it("reports format, columns, schema, a sample, and shortens long cells", () => {
    const long = "x".repeat(500);
    const r = buildTextReport(`{"prompt":"hi","completion":"${long}"}\n{"prompt":"a","completion":"b"}`, "d.jsonl");
    expect(r).toMatchObject({ kind: "text", format: "jsonl", rows: 2, invalid: 0, partial: false });
    expect(r.columns).toEqual(["prompt", "completion"]);
    expect(r.schema.id).toBe("prompt-completion");
    expect(r.sample[0]!.completion!.length).toBeLessThan(200);
    expect(r.sample[0]!.completion!.endsWith("…")).toBe(true);
  });
  it("counts bad lines instead of throwing, so the review can explain them", () => {
    const r = buildTextReport('{"a":1}\nnope\n[1]\n{"a":2}', "d.jsonl");
    expect(r.rows).toBe(2);
    expect(r.invalid).toBe(2);
    expect(r.errors[0]).toContain("line 2");
  });
  it("reports an unreadable CSV as an error, not an exception", () => {
    const r = buildTextReport('a,b\n"unterminated', "d.csv");
    expect(r.invalid).toBeGreaterThan(0);
    expect(r.errors[0]).toMatch(/quote/i);
  });
  it("drops the last, possibly cut, line of a partial read", () => {
    const r = buildTextReport('{"a":1}\n{"a":2}\n{"a":', "big.jsonl", true);
    expect(r).toMatchObject({ rows: 2, invalid: 0, partial: true });
  });
  it("handles pasted prompt | completion lines", () => {
    const r = buildTextReport("hi | hello\nbye | goodbye", "");
    expect(r).toMatchObject({ format: "pairs", rows: 2 });
    expect(r.schema.id).toBe("prompt-completion");
  });
});
