// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildVlmChatBody, createEnginePredict, replyText, runVlmEval, VLM_CONCURRENCY } from "@/lib/vlm-eval-runner";
import { createVlmEvalSetFromZip, readVlmEvalRows, type VlmEvalRow } from "@/lib/vlm-eval-set-store";
import { createVlmEvalRun, listVlmEvalRuns, readVlmEvalRun, saveVlmEvalRun, deleteVlmEvalRun } from "@/lib/vlm-eval-store";
import { makeZip } from "@/lib/vlm-eval-test-helpers";
import type { VlmScoring } from "@/lib/vlm-eval";

vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "rantai-vlm-run-"));
  process.env.RANTAI_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.RANTAI_DATA_DIR;
});
afterEach(() => vi.unstubAllGlobals());

const rows = (n = 12): VlmEvalRow[] =>
  Array.from({ length: n }, (_, i) => ({ id: i, images: [`images/img${i}.png`], prompt: `q${i}`, gold: `k${i}`, ...(i % 2 ? { category: "odd" } : { category: "even" }) }));

async function start(scoring: VlmScoring = "exact", total = 12) {
  return createVlmEvalRun({ setId: "s", setName: "S", model: "base", engine: "vllm", scoring, maxTokens: 256, total });
}

describe("runVlmEval", () => {
  it("scores every row and stores the report and the cases", async () => {
    const run = await start();
    await runVlmEval(run, rows(), async (row) => ({ text: row.id % 4 === 0 ? "wrong" : row.gold, tokens: 5 }));
    const done = (await readVlmEvalRun(run.id))!;
    expect(done).toMatchObject({ status: "done", progress: { completed: 12, total: 12, errors: 0, correct: 9 } });
    expect(done.finishedAt).toBeGreaterThanOrEqual(done.startedAt);
    expect(done.report).toMatchObject({ rows: 12, scored: 12, errors: 0, correct: 9, accuracy: 0.75, completionTokens: 60 });
    expect(done.report!.categories.map((c) => c.category).sort()).toEqual(["even", "odd"]);
    expect(done.cases).toHaveLength(12);
    expect(done.cases![0]).toMatchObject({ id: 0, image: "images/img0.png", prompt: "q0", gold: "k0", pred: "wrong", correct: false, score: 0, category: "even", tokens: 5 });
    expect(done.cases![0]!.latencyMs).toBeGreaterThanOrEqual(0);
    const listed = (await listVlmEvalRuns()).find((r) => r.id === run.id)!;
    expect(listed.report).toBeDefined();
    expect("cases" in listed).toBe(false); // history is cheap: no per-row cases
  });

  it("scores a latex run with CER", async () => {
    const run = await start("latex", 2);
    await runVlmEval(run, [
      { id: 0, images: ["images/a.png"], prompt: "p", gold: "x^2" },
      { id: 1, images: ["images/b.png"], prompt: "p", gold: "abcd" },
    ], async (row) => ({ text: row.id === 0 ? "$$ x ^ 2 $$" : "abxd" }));
    const done = (await readVlmEvalRun(run.id))!;
    expect(done.report).toMatchObject({ correct: 1, meanCer: 0.125 });
    expect(done.cases![1]).toMatchObject({ correct: false, cer: 0.25 });
  });

  it("leaves failed rows out of the metrics and says how many", async () => {
    const run = await start();
    await runVlmEval(run, rows(), async (row) => {
      if (row.id === 5) throw new Error("engine busy");
      return { text: row.gold };
    });
    const done = (await readVlmEvalRun(run.id))!;
    expect(done).toMatchObject({ status: "done", errorSample: "engine busy", progress: { completed: 12, errors: 1 } });
    expect(done.report).toMatchObject({ rows: 12, scored: 11, errors: 1, accuracy: 1 });
    expect(done.cases![5]).toMatchObject({ error: "engine busy", correct: false, pred: "" });
  });

  it("is an error, not a 0% score, when every request fails", async () => {
    const run = await start();
    await runVlmEval(run, rows(), async () => {
      throw new Error("vLLM down");
    });
    const done = (await readVlmEvalRun(run.id))!;
    expect(done.status).toBe("error");
    expect(done.error).toContain("vLLM down");
    expect(done.report).toBeUndefined();
    expect(done.progress).toMatchObject({ completed: 12, errors: 12 });
  });

  it("counts empty and truncated answers, and cuts a stored answer at 2000 characters", async () => {
    const run = await start("exact", 3);
    await runVlmEval(run, rows(3), async (row) => {
      if (row.id === 0) return { text: "" };
      if (row.id === 1) return { text: "x".repeat(5000), truncated: true };
      return { text: row.gold };
    });
    const done = (await readVlmEvalRun(run.id))!;
    expect(done.report).toMatchObject({ empty: 1, truncated: 1, correct: 1 });
    expect(done.cases![1]!.pred).toHaveLength(2000);
    expect(done.cases![1]!.truncated).toBe(true);
  });

  it("keeps at most two requests in flight (the engine is shared with production)", async () => {
    expect(VLM_CONCURRENCY).toBe(2);
    const run = await start();
    let inFlight = 0;
    let peak = 0;
    await runVlmEval(run, rows(), async (row) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { text: row.gold };
    });
    expect(peak).toBe(2);
  });

  it("saves progress after every row", async () => {
    const run = await start("exact", 6);
    const seen: number[] = [];
    await runVlmEval(run, rows(6), async (row) => {
      const cur = (await readVlmEvalRun(run.id))!;
      seen.push(cur.progress.completed);
      return { text: row.gold };
    });
    // Each request starts after earlier rows were saved: completed grows as the run goes.
    expect(seen.at(-1)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...seen)).toBeGreaterThan(Math.min(...seen));
  });

  it("does not bring back a run deleted while it was going", async () => {
    const run = await start("exact", 2);
    await runVlmEval(run, rows(2), async (row) => {
      if (row.id === 1) await deleteVlmEvalRun(run.id);
      else await new Promise((r) => setTimeout(r, 40)); // row 0 reports after the delete
      return { text: row.gold };
    });
    expect(await readVlmEvalRun(run.id)).toBeNull();
  });

  it("reports a running run whose process vanished as interrupted", async () => {
    const run = await start();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await saveVlmEvalRun(run);
    vi.setSystemTime(Date.now() + 11 * 60 * 1000);
    const read = await readVlmEvalRun(run.id);
    vi.useRealTimers();
    expect(read!.status).toBe("interrupted");
  });

  it("refuses an unsafe run id", async () => {
    await expect(readVlmEvalRun("../../x")).rejects.toThrow(/Invalid/);
  });

  it("keeps only the newest 30 finished runs", async () => {
    for (let i = 0; i < 33; i++) {
      const r = await start("exact", 1);
      await runVlmEval(r, rows(1), async (row) => ({ text: row.gold }));
    }
    // A run still going is never pruned, so count the finished ones.
    expect((await listVlmEvalRuns()).filter((r) => r.status !== "running").length).toBeLessThanOrEqual(30);
  });
});

describe("buildVlmChatBody", () => {
  const row: VlmEvalRow = { id: 0, images: ["images/a.png", "images/b.png"], prompt: "What?", gold: "g", system: "Be brief." };
  it("puts the images first, then the prompt, at temperature 0 without streaming", () => {
    const body = buildVlmChatBody({ model: "base", row, imageUrls: ["data:image/png;base64,AAA", "data:image/png;base64,BBB"], maxTokens: 256 });
    expect(body).toEqual({
      model: "base",
      messages: [
        { role: "system", content: "Be brief." },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
            { type: "image_url", image_url: { url: "data:image/png;base64,BBB" } },
            { type: "text", text: "What?" },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 256,
      stream: false,
    });
  });
  it("has no system message when the row has none", () => {
    const body = buildVlmChatBody({ model: "m", row: { ...row, system: undefined }, imageUrls: ["u"], maxTokens: 8 });
    expect(body.messages.map((m) => m.role)).toEqual(["user"]);
  });
});

describe("replyText", () => {
  it("reads a string, parts, and drops a leading <think> block", () => {
    expect(replyText("  hi  ")).toBe("hi");
    expect(replyText([{ type: "text", text: "a" }, { type: "text", text: "b" }])).toBe("ab");
    expect(replyText("<think>hmm\nlet me see</think>\n\n34.6")).toBe("34.6");
    expect(replyText(null)).toBe("");
    expect(replyText(42)).toBe("");
  });
});

describe("createEnginePredict", () => {
  const engine = { id: "vllm" as const, label: "vLLM", v1BaseUrl: "http://engine/v1", configured: true, headers: { "Content-Type": "application/json", Authorization: "Bearer k" } };

  it("posts the image from the set as a data URL and reads the answer, tokens and truncation", async () => {
    const set = await createVlmEvalSetFromZip({ name: "pred set", scoring: "exact", zip: makeZip({ n: 5 }) });
    const [row] = (await readVlmEvalRows(set.id))!;
    const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: "k0" }, finish_reason: "length" }], usage: { completion_tokens: 7 } }));
    vi.stubGlobal("fetch", fetchMock);
    const out = await createEnginePredict({ engine, model: "base", setId: set.id, maxTokens: 64 })(row!);
    expect(out).toEqual({ text: "k0", tokens: 7, truncated: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://engine/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "base", temperature: 0, max_tokens: 64, stream: false });
    const parts = body.messages[0].content;
    expect(parts[0].image_url.url).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);
    expect(parts[1]).toEqual({ type: "text", text: "What is in image 0?" });
  });

  it("turns an HTTP error, a reply without a choice and a missing image into errors", async () => {
    const set = await createVlmEvalSetFromZip({ name: "pred set 2", scoring: "exact", zip: makeZip({ n: 5 }) });
    const [row] = (await readVlmEvalRows(set.id))!;
    const predict = createEnginePredict({ engine, model: "base", setId: set.id, maxTokens: 64 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("model overloaded\n  try later", { status: 503 })));
    await expect(predict(row!)).rejects.toThrow("vLLM answered 503: model overloaded try later");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [] })));
    await expect(predict(row!)).rejects.toThrow(/without a choice/);
    await expect(predict({ ...row!, images: ["images/missing.png"] })).rejects.toThrow(/missing from the test set/);
  });

  it("does not put the API key in an error", async () => {
    const set = await createVlmEvalSetFromZip({ name: "pred set 3", scoring: "exact", zip: makeZip({ n: 5 }) });
    const [row] = (await readVlmEvalRows(set.id))!;
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 401 })));
    const err = await createEnginePredict({ engine, model: "base", setId: set.id, maxTokens: 8 })(row!).catch((e: Error) => e);
    expect((err as Error).message).not.toContain("Bearer k");
  });
});
