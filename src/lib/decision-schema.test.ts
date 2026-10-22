import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { validateDecisionJsonl, validateDecisionRow } from "@/lib/decision-schema";

// The Python validator that runs inside the training job reads the SAME file
// (trainers/unsloth-decision-train/test_decision_schema.py). A row one accepts and the other
// rejects would let an upload pass and then fail minutes into a GPU job.
const FIXTURE = join(process.cwd(), "trainers", "unsloth-decision-train", "fixtures", "schema_cases.jsonl");
const cases = readFileSync(FIXTURE, "utf-8")
  .split(/\r?\n/)
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as unknown);

describe("decision schema: shared fixture with the Python validator", () => {
  it("has both valid and invalid cases", () => {
    expect(cases.length).toBeGreaterThan(40);
  });

  for (const c of cases) {
    const o = (typeof c === "object" && c !== null ? c : {}) as { _expect?: string; _why?: string };
    const expected = o._expect ?? "invalid";
    const label = o._why ?? "a JSON scalar line";
    it(`${expected}: ${label}`, () => {
      const problems = validateDecisionRow(c);
      expect(problems.length === 0 ? "valid" : "invalid").toBe(expected);
    });
  }
});

describe("validateDecisionRow messages", () => {
  const q = { type: "choice", criteria: { a: "x", b: "y" } };

  it("names the question and the options for a wrong label", () => {
    const [msg] = validateDecisionRow({ state: "s", questions: { team: q }, gold: { team: "zz" } });
    expect(msg).toContain('question "team"');
    expect(msg).toContain("not one of the options (a, b)");
  });

  it("says what is wrong with the criteria", () => {
    expect(validateDecisionRow({ state: "s", questions: { t: { type: "rank" } }, gold: { t: 1 } })[0]).toContain(
      "type must be one of"
    );
    expect(
      validateDecisionRow({ state: "s", questions: { t: { type: "choice", criteria: ["x"] } }, gold: { t: "x" } })[0]
    ).toContain("2 to 255 options");
  });
});

describe("validateDecisionJsonl", () => {
  const good = JSON.stringify({ state: "s", questions: { t: { type: "choice", criteria: ["a", "b"] } }, gold: { t: "a" } });
  const badLabel = JSON.stringify({ state: "s", questions: { t: { type: "choice", criteria: ["a", "b"] } }, gold: { t: "z" } });

  it("counts valid and invalid rows and reports the first problems with real line numbers", () => {
    const text = [good, "", badLabel, "{not json", good].join("\n");
    const r = validateDecisionJsonl(text);
    expect(r).toMatchObject({ total: 4, valid: 2, invalid: 2 });
    expect(r.errors[0]).toMatch(/^row 3: question "t"/);
    expect(r.errors[1]).toBe("row 4: not valid JSON");
  });

  it("summarises the label distribution per question", () => {
    const text = [good, good, JSON.stringify({ state: "s", questions: { t: { type: "choice", criteria: ["a", "b"] } }, gold: { t: "b" } })].join("\n");
    const r = validateDecisionJsonl(text);
    expect(r.questions.t).toEqual({ type: "choice", rows: 3, labels: { a: 2, b: 1 } });
  });

  it("uses the most probable option for a soft label", () => {
    const soft = JSON.stringify({
      state: "s",
      questions: { t: { type: "choice", criteria: ["a", "b"] } },
      gold: { t: { probabilities: { a: 0.2, b: 0.8 } } },
    });
    expect(validateDecisionJsonl(soft).questions.t!.labels).toEqual({ b: 1 });
  });

  it("caps how many errors it describes", () => {
    const r = validateDecisionJsonl(Array(30).fill(badLabel).join("\n"), 5);
    expect(r.invalid).toBe(30);
    expect(r.errors).toHaveLength(5);
  });
});
