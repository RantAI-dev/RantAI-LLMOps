import { describe, expect, it } from "vitest";

import { reviewDecision, reviewText, reviewVision } from "@/modules/datasets/lib/review";
import type { VisionZipLayout } from "@/modules/datasets/lib/vision-zip";

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

describe("reviewText on a JSON array cut off at the review limit", () => {
  it("does not block the upload (the server checks the whole file)", () => {
    const cut = '[{"prompt":"a","completion":"b"},{"prompt":"c","comple';
    expect(reviewText(cut, "big.json", true).blocked).toBeNull();
    expect(reviewText(cut, "big.json", false).blocked).not.toBeNull();
  });
});

describe("reviewVision", () => {
  const vrow = (img: string, n = 0) =>
    JSON.stringify({
      messages: [
        { role: "user", content: [{ type: "image", image: img }, { type: "text", text: `Q${n}` }] },
        { role: "assistant", content: `A${n}` },
      ],
    });
  const vrows = (n: number, img = (i: number) => `images/${i % 5}.png`) => Array.from({ length: n }, (_, i) => vrow(img(i), i)).join("\n");
  const layout = (paths: string[], size = 100, extra: Partial<VisionZipLayout> = {}): VisionZipLayout => ({
    prefix: "",
    train: { name: "train.jsonl", size: 1000 },
    eval: null,
    images: paths.map((p) => ({ path: p, zipName: p, size })),
    rejected: [],
    ignored: 0,
    ...extra,
  });
  const five = [0, 1, 2, 3, 4].map((i) => `images/${i}.png`);

  it("passes a complete ZIP and summarises it", () => {
    const r = reviewVision({ layout: layout(five), trainText: vrows(30), evalText: null, zipBytes: 5000 });
    expect(r.blocked).toBeNull();
    expect(r).toMatchObject({ imageCount: 5, imageBytes: 500, missing: [], unused: [] });
    expect(r.train).toMatchObject({ total: 30, valid: 30, imagesReferenced: 5 });
    expect(r.sample).toHaveLength(8);
    expect(r.sample[0]).toEqual({ images: ["images/0.png"], system: "", user: "Q0", assistant: "A0" });
  });

  it("lists unused images without blocking", () => {
    const r = reviewVision({ layout: layout([...five, "images/spare.png"]), trainText: vrows(30), evalText: null, zipBytes: 1 });
    expect(r.blocked).toBeNull();
    expect(r.unused).toEqual(["images/spare.png"]);
  });

  it("blocks on ONE missing image, even in a large dataset, and names it", () => {
    const text = vrows(300) + "\n" + vrow("images/lost.png");
    const r = reviewVision({ layout: layout(five), trainText: text, evalText: null, zipBytes: 1 });
    expect(r.missing).toEqual(["images/lost.png"]);
    expect(r.blocked).toMatch(/images\/lost\.png/);
  });

  it("blocks without train.jsonl, with too few rows, and on a bad eval file", () => {
    expect(reviewVision({ layout: layout(five, 100, { train: null }), trainText: null, evalText: null, zipBytes: 1 }).blocked).toMatch(/train\.jsonl at its top level/);
    expect(reviewVision({ layout: layout(five), trainText: vrows(5), evalText: null, zipBytes: 1 }).blocked).toMatch(/at least 20/);
    expect(reviewVision({ layout: layout(five), trainText: vrows(30), evalText: vrows(2), zipBytes: 1 }).blocked).toMatch(/eval\.jsonl has 2 valid rows; at least 5/);
    expect(reviewVision({ layout: layout(five), trainText: vrows(30), evalText: vrows(6), zipBytes: 1 }).blocked).toBeNull();
  });

  it("blocks a row-level problem past 2% and reports lines", () => {
    const r = reviewVision({ layout: layout(five), trainText: vrows(40) + "\n" + "garbage\n".repeat(3), evalText: null, zipBytes: 1 });
    expect(r.blocked).toMatch(/3 of 43 train\.jsonl rows are invalid/);
    expect(r.train!.problems[0]).toMatchObject({ line: 41, why: "not valid JSON" });
  });

  it("blocks an oversize image and a ZIP over the total limit", () => {
    const limits = { maxDatasetBytes: 1000, maxImageBytes: 50 };
    expect(reviewVision({ layout: layout(five, 100), trainText: vrows(30), evalText: null, zipBytes: 10, limits }).blocked).toMatch(/5 images are larger than/);
    expect(reviewVision({ layout: layout(five, 10), trainText: vrows(30), evalText: null, zipBytes: 5000, limits }).blocked).toMatch(/larger than/);
  });
});
