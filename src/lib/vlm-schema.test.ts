import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { validateVlmJsonl, validateVlmRow, vlmDatasetProblem } from "@/lib/vlm-schema";

// The Python validator that runs inside the training job reads the SAME file
// (trainers/unsloth-vision-train/test_vlm_schema.py). A row one accepts and the other rejects would let an
// upload pass and then fail minutes into a GPU job. The convention for `imageExists` in the fixture: an
// image whose path contains "missing" is not in the dataset.
const FIXTURE = join(process.cwd(), "trainers", "unsloth-vision-train", "fixtures", "vlm_cases.jsonl");
const cases = readFileSync(FIXTURE, "utf-8")
  .split(/\r?\n/)
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as unknown);
const exists = (p: string) => !p.includes("missing");

describe("vlm schema: shared fixture with the Python validator", () => {
  it("has both valid and invalid cases", () => {
    expect(cases.length).toBeGreaterThan(40);
  });

  for (const c of cases) {
    const o = (typeof c === "object" && c !== null && !Array.isArray(c) ? c : {}) as {
      _expect?: string;
      _why?: string;
      _error?: string;
    };
    const expected = o._expect ?? "invalid";
    it(`${expected}: ${o._why ?? "a JSON line that is not an object"}`, () => {
      const r = validateVlmRow(c, { imageExists: exists });
      expect(r.ok ? "valid" : "invalid").toBe(expected);
      if (expected === "valid") expect(r.why).toBe("");
      else if (o._error) expect(r.why).toContain(o._error);
    });
  }
});

const row = (ref = "images/a.jpg", answer = "A") => ({
  messages: [
    { role: "user", content: [{ type: "image", image: ref }, { type: "text", text: "Q" }] },
    { role: "assistant", content: answer },
  ],
});

describe("validateVlmRow options", () => {
  it("maxImages is configurable (default 4)", () => {
    const r = {
      messages: [
        { role: "user", content: [0, 1, 2].map((i) => ({ type: "image", image: `images/${i}.png` })).concat([{ type: "text", text: "Q" } as never]) },
        { role: "assistant", content: "A" },
      ],
    };
    expect(validateVlmRow(r).ok).toBe(true);
    const bad = validateVlmRow(r, { maxImages: 2 });
    expect(bad.ok).toBe(false);
    expect(bad.why).toContain("at most 2");
  });

  it("asks imageExists only for relative paths, normalized", () => {
    const asked: string[] = [];
    const r = {
      messages: [
        {
          role: "user",
          content: [
            { type: "image", image: "./images/a.png" },
            { type: "image", image: "https://example.com/b.png" },
            { type: "image", image: "s3://bkt/c.png" },
            { type: "text", text: "Q" },
          ],
        },
        { role: "assistant", content: "A" },
      ],
    };
    expect(validateVlmRow(r, { imageExists: (p) => (asked.push(p), true) })).toEqual({ ok: true, why: "" });
    expect(asked).toEqual(["images/a.png"]);
  });
});

describe("validateVlmJsonl", () => {
  it("counts rows, keeps real line numbers and lists referenced / missing images", () => {
    const text = [
      JSON.stringify(row()),
      "",
      JSON.stringify(row("images/missing.png")),
      "oops",
      JSON.stringify({ messages: [] }),
      JSON.stringify(row("images/b.png")),
    ].join("\n");
    const rep = validateVlmJsonl(text, { imageExists: exists });
    expect(rep).toMatchObject({ total: 5, valid: 2, invalid: 3, invalidRatio: 0.6, imagesReferenced: 3 });
    expect(rep.problems.map((p) => p.line)).toEqual([3, 4, 5]);
    expect(rep.problems[1]!.why).toBe("not valid JSON");
    expect(rep.missing).toEqual(["images/missing.png"]);
    expect(rep.referenced.sort()).toEqual(["images/a.jpg", "images/b.png", "images/missing.png"]);
  });

  it("caps the problem list at 20 and strips a BOM", () => {
    const rep = validateVlmJsonl("﻿" + Array(50).fill('{"messages":[]}').join("\n"));
    expect(rep.invalid).toBe(50);
    expect(rep.problems).toHaveLength(20);
  });
});

describe("vlmDatasetProblem", () => {
  const rows = (n: number, bad = 0) =>
    [...Array(n - bad).fill(JSON.stringify(row())), ...Array(bad).fill('{"messages":[]}')].join("\n");

  it("accepts a clean dataset", () => {
    expect(vlmDatasetProblem(validateVlmJsonl(rows(30)))).toBeNull();
  });
  it("explains an empty one and one with too few rows", () => {
    expect(vlmDatasetProblem(validateVlmJsonl(""))).toContain("empty");
    expect(vlmDatasetProblem(validateVlmJsonl(rows(10)))).toContain("at least 20");
    expect(vlmDatasetProblem(validateVlmJsonl(rows(10)), "eval", 5)).toBeNull();
  });
  it("allows up to 2% invalid rows and names the first problems beyond that", () => {
    expect(vlmDatasetProblem(validateVlmJsonl(rows(60, 1)))).toBeNull();
    const msg = vlmDatasetProblem(validateVlmJsonl(rows(60, 2)));
    expect(msg).toContain("2 of 60");
    expect(msg).toContain("line 59");
  });
});

describe("validVlmLines and vlmRowSummary", () => {
  it("keeps only the valid lines, as written", async () => {
    const { validVlmLines } = await import("@/lib/vlm-schema");
    const good = JSON.stringify(row());
    const out = validVlmLines(`${good}\n\nnot json\n${JSON.stringify(row("images/missing.png"))}\n  ${good}  \n`, { imageExists: exists });
    expect(out).toBe(`${good}\n${good}`);
  });

  it("summarises a row", async () => {
    const { vlmRowSummary } = await import("@/lib/vlm-schema");
    const s = vlmRowSummary({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: [{ type: "image", image: "images/a.png" }, { type: "image_url", image_url: { url: "https://x.example.com/b.png" } }, { type: "text", text: "Q?" }] },
        { role: "assistant", content: [{ type: "text", text: "A!" }] },
      ],
    });
    expect(s).toEqual({ images: ["images/a.png", "https://x.example.com/b.png"], system: "sys", user: "Q?", assistant: "A!" });
    expect(vlmRowSummary(null)).toEqual({ images: [], system: "", user: "", assistant: "" });
  });
});

describe("vlmMissingImagesProblem", () => {
  it("is null without missing images and names them otherwise, even when few rows are affected", async () => {
    const { vlmMissingImagesProblem } = await import("@/lib/vlm-schema");
    const rowsText = [...Array(200).fill(JSON.stringify(row())), JSON.stringify(row("images/missing_1.png"))].join("\n");
    expect(vlmMissingImagesProblem(validateVlmJsonl(rowsText))).toBeNull(); // no imageExists given: not checked
    const rep = validateVlmJsonl(rowsText, { imageExists: exists });
    expect(vlmDatasetProblem(rep)).toBeNull(); // 1 of 201 rows is within the 2% allowance ...
    expect(vlmMissingImagesProblem(rep, "train.jsonl")).toBe("1 image that is used by the train.jsonl is not in the dataset: images/missing_1.png.");
    const many = [1, 2, 3, 4, 5].map((i) => JSON.stringify(row(`images/missing_${i}.png`))).join("\n");
    expect(vlmMissingImagesProblem(validateVlmJsonl(many, { imageExists: exists }))).toContain("5 images that are used by the dataset are not in the dataset: images/missing_1.png, images/missing_2.png, images/missing_3.png and 2 more.");
  });
});
