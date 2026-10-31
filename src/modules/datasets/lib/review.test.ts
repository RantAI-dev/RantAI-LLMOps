import { describe, expect, it } from "vitest";

import { reviewDecision, reviewText } from "@/modules/datasets/lib/review";

const dRow = (i: number) =>
  JSON.stringify({ state: `t${i}`, questions: { q: { type: "noul" } }, gold: { q: i % 2 === 0 } });
const dRows = (n: number) => Array.from({ length: n }, (_, i) => dRow(i)).join("\n");

describe("reviewText", () => {
  it("passes a clean file and describes it", () => {
    const r = reviewText('{"prompt":"a","completion":"b"}\n{"prompt":"c","completion":"d"}', "d.jsonl", false);
    expect(r.blocked).toBeNull();
    expect(r.report).toMatchObject({ rows: 2, format: "jsonl" });
    expect(r.report.schema.recognised).toBe(true);
  });
  it("blocks an empty file and says what was wrong", () => {
    expect(reviewText("", "d.jsonl", false).blocked).toBeTruthy();
    expect(reviewText('a,b\n"unterminated', "d.csv", false).blocked).toMatch(/quote/i);
  });
  it("blocks a file with an unreadable line, because the server would refuse it", () => {
    const r = reviewText('{"a":1}\nnope\n{"a":2}', "d.jsonl", false);
    expect(r.blocked).toMatch(/1 line could not be read/);
  });
  it("lets an unrecognised column layout through (the columns are chosen later), but flags it", () => {
    const r = reviewText('{"foo":1}', "d.jsonl", false);
    expect(r.blocked).toBeNull();
    expect(r.report.schema.recognised).toBe(false);
  });
});

describe("reviewDecision", () => {
  it("passes a valid dataset and shows an example row", () => {
    const r = reviewDecision(dRows(30), "t.jsonl", false);
    expect(r.blocked).toBeNull();
    expect(r.report).toMatchObject({ total: 30, valid: 30 });
    expect(JSON.parse(r.example!)).toMatchObject({ state: "t0" });
  });
  it("blocks too few rows (train: 20, eval: 5) the same way the server does", () => {
    expect(reviewDecision(dRows(10), "t.jsonl", false).blocked).toMatch(/at least 20/);
    expect(reviewDecision(dRows(10), "e.jsonl", false, "eval").blocked).toBeNull();
    expect(reviewDecision(dRows(3), "e.jsonl", false, "eval").blocked).toMatch(/at least 5/);
  });
  it("blocks CSV and prompt | completion lines", () => {
    expect(reviewDecision("a,b\n1,2", "x.csv", false).blocked).toMatch(/JSONL or a JSON array/);
    expect(reviewDecision("a | b", "", false).blocked).toMatch(/JSONL or a JSON array/);
  });
  it("accepts a JSON array and explains a broken one", () => {
    expect(reviewDecision(`[${dRows(30).split("\n").join(",")}]`, "t.json", false).blocked).toBeNull();
    expect(reviewDecision("[1,2]", "t.json", false).blocked).toMatch(/not a JSON object/);
  });
  it("only blocks a large file's preview when its start has nothing usable", () => {
    const part = reviewDecision(dRows(5) + '\n{"state":"cut', "big.jsonl", true);
    expect(part.blocked).toBeNull(); // 5 valid rows in the first MB: the full file is checked on save
    expect(part.report.valid).toBe(5);
    expect(reviewDecision("garbage\nmore garbage\n", "big.jsonl", true).blocked).toBeTruthy();
    expect(reviewDecision("[{", "big.json", true).blocked).toBeNull(); // cannot preview a cut JSON array
  });
});
