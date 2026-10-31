// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { parseDecisionEvalSet } from "@/lib/decision-eval";
import { runDecisionEval } from "@/lib/decision-eval-runner";
import {
  addDecisionEvalSet,
  deleteDecisionEvalSet,
  listDecisionEvalSets,
  readDecisionEvalSet,
} from "@/lib/decision-eval-set-store";
import { createDecisionEvalRun, listDecisionEvalRuns, readDecisionEvalRun } from "@/lib/decision-eval-store";

vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "rantai-eval-"));
  process.env.RANTAI_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.RANTAI_DATA_DIR;
});

const mkRow = (i: number) =>
  JSON.stringify({
    state: `ticket ${i}`,
    questions: { team: { type: "choice", criteria: { billing: "b", technical: "t" } }, refund: { type: "noul" } },
    gold: { team: i % 2 ? "billing" : "technical", refund: i % 3 === 0 },
  });
const rows = Array.from({ length: 12 }, (_, i) => mkRow(i)).join("\n");

const answerFor = (state: unknown) => {
  const i = Number(String(state).replace("ticket ", ""));
  const team = i % 2 ? "billing" : "technical"; // always right on team
  return {
    team: { type: "choice", choice: team, probabilities: { [team]: 0.9, [team === "billing" ? "technical" : "billing"]: 0.1 } },
    refund: { type: "noul", noul: i % 3 === 0 ? 0.8 : 0.2, answer: i % 3 === 0, probabilities: { true: 0.8, false: 0.2 } },
  };
};

async function start(setId = "t") {
  const parsed = parseDecisionEvalSet(rows);
  const run = await createDecisionEvalRun({ model: "m", setId, setName: "T", total: parsed.rows.length, meta: parsed.meta });
  return { run, parsed };
}

describe("test sets", () => {
  it("validates, saves, lists, reads and deletes a set", async () => {
    const many = Array.from({ length: 100 }, (_, i) => mkRow(i)).join("\n");
    const { set, invalid } = await addDecisionEvalSet({ name: "My Tickets!", content: many + "\nnot json", source: "upload" });
    expect(set).toMatchObject({ id: "my-tickets", rows: 100, source: "upload" });
    expect(set.questions).toEqual(["team", "refund"]);
    expect(invalid).toBe(1);
    expect((await listDecisionEvalSets()).map((s) => s.id)).toContain("my-tickets");
    expect((await readDecisionEvalSet("my-tickets"))?.jsonl.split("\n")).toHaveLength(100);
    await deleteDecisionEvalSet("my-tickets");
    expect(await readDecisionEvalSet("my-tickets")).toBeNull();
  });

  it("refuses a duplicate name, too few rows, CSV, and an unsafe id", async () => {
    await addDecisionEvalSet({ name: "dup", content: rows, source: "upload" });
    await expect(addDecisionEvalSet({ name: "dup", content: rows, source: "upload" })).rejects.toThrow(/already exists/);
    await expect(addDecisionEvalSet({ name: "few", content: mkRow(1), source: "upload" })).rejects.toThrow(/at least 5/);
    await expect(addDecisionEvalSet({ name: "csv", content: "a,b\n1,2", filename: "x.csv", source: "upload" })).rejects.toThrow(/JSONL/);
    await expect(addDecisionEvalSet({ name: "!!!", content: rows, source: "upload" })).rejects.toThrow(/name is required/);
    await expect(readDecisionEvalSet("../etc/passwd")).rejects.toThrow(/Invalid/);
  });
});

describe("runDecisionEval", () => {
  it("scores every row and stores the report and the cases", async () => {
    const { run, parsed } = await start();
    await runDecisionEval(run, parsed.rows, async (row) => answerFor(row.state));
    const done = await readDecisionEvalRun(run.id);
    expect(done).toMatchObject({ status: "done", completed: 12, errorCount: 0 });
    expect(done!.report!.decisions).toBe(24);
    expect(done!.report!.accuracy).toBe(1);
    expect(done!.cases).toHaveLength(12);
    const listed = (await listDecisionEvalRuns()).find((r) => r.id === run.id);
    expect(listed).toBeDefined();
    expect("cases" in listed!).toBe(false); // history is cheap: no per-row cases
  });

  it("leaves failed rows out of the metrics and says how many", async () => {
    const { run, parsed } = await start();
    await runDecisionEval(run, parsed.rows, async (row) => {
      if (String(row.state).endsWith("5")) throw new Error("model busy");
      return answerFor(row.state);
    });
    const done = await readDecisionEvalRun(run.id);
    expect(done).toMatchObject({ status: "done", errorCount: 1, errorSample: "model busy" });
    expect(done!.report).toMatchObject({ rows: 12, scoredRows: 11, accuracy: 1 });
  });

  it("is an error, not a 0% score, when every request fails", async () => {
    const { run, parsed } = await start();
    await runDecisionEval(run, parsed.rows, async () => {
      throw new Error("decision server down");
    });
    const done = await readDecisionEvalRun(run.id);
    expect(done!.status).toBe("error");
    expect(done!.error).toContain("decision server down");
    expect(done!.report).toBeUndefined();
  });

  it("is an error when no gold label matches the model's questions", async () => {
    const { run, parsed } = await start();
    await runDecisionEval(run, parsed.rows, async () => ({ unrelated: { type: "noul", noul: 0.9 } }));
    const done = await readDecisionEvalRun(run.id);
    expect(done!.status).toBe("error");
    expect(done!.error).toMatch(/did not match/);
  });

  it("reports a running run whose process vanished as interrupted", async () => {
    const { run } = await start();
    const old = { ...run, updatedAt: Date.now() - 10 * 60 * 1000 };
    const { saveDecisionEvalRun } = await import("@/lib/decision-eval-store");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await saveDecisionEvalRun(old); // save stamps updatedAt = now: rewind the clock the store sees
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);
    const read = await readDecisionEvalRun(run.id);
    vi.useRealTimers();
    expect(read!.status).toBe("interrupted");
  });

  it("refuses an unsafe run id", async () => {
    await expect(readDecisionEvalRun("../../x")).rejects.toThrow(/Invalid/);
  });
});
