// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A fake Transformer Lab + S3: the point is WHAT gets stored and where, and what is refused first.
const tl = vi.hoisted(() => ({
  datasets: [] as string[],
  uploads: [] as Array<{ id: string; files: Record<string, string> }>,
  failUpload: false,
  deleted: [] as string[],
}));
const s3 = vi.hoisted(() => ({ puts: [] as Array<{ bucket: string; key: string; body: string }> }));

vi.mock("@/lib/tl-fetch", () => ({
  tlFetch: vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url, "http://tl");
    const id = u.searchParams.get("dataset_id") ?? "";
    if (u.pathname === "/data/list") return Response.json(tl.datasets.map((d) => ({ dataset_id: d })));
    if (u.pathname === "/data/new") {
      tl.datasets.push(id);
      return Response.json({ status: "success" });
    }
    if (u.pathname === "/data/fileupload") {
      if (tl.failUpload) return new Response("boom", { status: 500 });
      const files: Record<string, string> = {};
      for (const [, v] of (init!.body as FormData).entries()) {
        const f = v as File;
        files[f.name] = await f.text();
      }
      tl.uploads.push({ id, files });
      return Response.json({ status: "success" });
    }
    if (u.pathname === "/data/delete") {
      tl.deleted.push(id);
      tl.datasets = tl.datasets.filter((d) => d !== id);
      return Response.json({ status: "success" });
    }
    return new Response("not found", { status: 404 });
  }),
  unwrapList: (x: unknown) => x,
}));
vi.mock("@/lib/s3", () => ({
  putObject: vi.fn(async (bucket: string, key: string, body: string) => {
    s3.puts.push({ bucket, key, body });
    return `s3://${bucket}/${key}`;
  }),
  s3Configured: () => true,
}));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));
vi.mock("@/lib/tasks-server", () => ({ allExperimentIds: vi.fn(), createTlExperiment: vi.fn(), resolveJobExperiment: vi.fn() }));
vi.mock("@/lib/models-catalog", () => ({ fetchAdaptors: vi.fn() }));

import { ingestDataset, createDataset, createDatasetOnS3 } from "@/lib/finetune";
import { readDecisionEvalSet } from "@/lib/decision-eval-set-store";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "rantai-ingest-"));
  process.env.RANTAI_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.RANTAI_DATA_DIR;
});
beforeEach(() => {
  tl.datasets = [];
  tl.uploads = [];
  tl.failUpload = false;
  tl.deleted = [];
  s3.puts = [];
});

const decisionRow = (i: number) =>
  JSON.stringify({
    state: `ticket ${i}`,
    questions: { team: { type: "choice", criteria: { billing: "b", technical: "t" } } },
    gold: { team: i % 2 ? "billing" : "technical" },
  });
const decisionRows = (n: number) => Array.from({ length: n }, (_, i) => decisionRow(i)).join("\n");

describe("ingestDataset: text", () => {
  it("stores any supported format as JSONL in the workspace and reports what the trainer will see", async () => {
    const r = await ingestDataset({ name: "My Data", kind: "text", filename: "d.csv", content: "question,answer\nApa?,Ini\nSiapa?,Itu" });
    expect(r).toMatchObject({ id: "my-data", ref: "my-data", kind: "text" });
    expect(r.report).toMatchObject({ rows: 2, format: "csv" });
    expect((r.report as { schema: { id: string } }).schema.id).toBe("question-answer");
    expect(tl.uploads[0]!.files["my-data_train.jsonl"]).toBe('{"question":"Apa?","answer":"Ini"}\n{"question":"Siapa?","answer":"Itu"}');
  });

  it("accepts pasted prompt | completion lines (what the old paste form took)", async () => {
    const r = await ingestDataset({ name: "pasted", kind: "text", content: "hi | hello\nbye | goodbye" });
    expect(r.report).toMatchObject({ rows: 2, format: "pairs" });
  });

  it("refuses a bad file before anything is stored", async () => {
    await expect(ingestDataset({ name: "bad", kind: "text", filename: "x.jsonl", content: '{"a":1}\nnope' })).rejects.toThrow(/Row 2/);
    expect(tl.datasets).toEqual([]);
  });

  it("refuses a name with no letters or digits, and a name that is already taken", async () => {
    await expect(ingestDataset({ name: "!!!", kind: "text", content: "a | b" })).rejects.toThrow(/name is required/);
    await ingestDataset({ name: "taken", kind: "text", content: "a | b" });
    await expect(ingestDataset({ name: "Taken!", kind: "text", content: "a | b" })).rejects.toThrow(/already exists/);
  });

  it("removes the empty dataset when the file upload fails, so a retry is not blocked", async () => {
    tl.failUpload = true;
    await expect(ingestDataset({ name: "flaky", kind: "text", content: "a | b" })).rejects.toThrow(/upload failed/);
    expect(tl.deleted).toEqual(["flaky"]);
    tl.failUpload = false;
    await expect(ingestDataset({ name: "flaky", kind: "text", content: "a | b" })).resolves.toMatchObject({ id: "flaky" });
  });

  it("saves to S3 as prompt/completion rows, mapping instruction/output", async () => {
    const r = await ingestDataset({
      name: "s3 set",
      kind: "text",
      filename: "d.jsonl",
      content: '{"instruction":"Translate","input":"hi","output":"halo"}',
      destination: { kind: "s3", bucket: "sft", prefix: "/datasets/" },
    });
    expect(r.ref).toBe("s3://sft/datasets/s3-set/train.jsonl");
    expect(JSON.parse(s3.puts[0]!.body)).toEqual({ prompt: "Translate\n\nhi", completion: "halo" });
    expect(tl.datasets).toEqual([]); // nothing in the workspace
  });

  it("will not save unrecognised columns to S3 (the trainer could not read them)", async () => {
    await expect(
      ingestDataset({ name: "x", kind: "text", filename: "d.jsonl", content: '{"a":1}', destination: { kind: "s3", bucket: "b" } })
    ).rejects.toThrow(/prompt\/completion/);
    await expect(ingestDataset({ name: "x", kind: "text", content: "a | b", destination: { kind: "s3", bucket: " " } })).rejects.toThrow(/bucket/);
  });

  it("keeps the rows API (createDataset / createDatasetOnS3) on the same path", async () => {
    expect(await createDataset("api rows", [{ prompt: "p", completion: "c" }])).toBe("api-rows");
    expect(tl.uploads[0]!.files["api-rows_train.jsonl"]).toBe('{"prompt":"p","completion":"c"}');
    const s = await createDatasetOnS3("api s3", [{ prompt: "p", completion: "c" }], "sft");
    expect(s).toEqual({ id: "api-s3", ref: "s3://sft/datasets/api-s3/train.jsonl" });
  });
});

describe("ingestDataset: decision", () => {
  it("stores valid rows and registers the test file as an eval set", async () => {
    const r = await ingestDataset({
      name: "Tickets",
      kind: "decision",
      filename: "t.jsonl",
      content: decisionRows(30),
      evalContent: decisionRows(10),
      evalFilename: "e.jsonl",
    });
    expect(r).toMatchObject({ id: "tickets", ref: "tickets", kind: "decision", evalSetId: "tickets" });
    expect(Object.keys(tl.uploads[0]!.files).sort()).toEqual(["tickets_eval.jsonl", "tickets_train.jsonl"]);
    expect((await readDecisionEvalSet("tickets"))!.meta).toMatchObject({ rows: 10, source: "dataset", questions: ["team"] });
  });

  it("registers the test file as huggingface-sourced when it came from there", async () => {
    await ingestDataset({ name: "hf one", kind: "decision", content: decisionRows(30), evalContent: decisionRows(10), evalSource: "huggingface" });
    expect((await readDecisionEvalSet("hf-one"))!.meta.source).toBe("huggingface");
  });

  it("refuses CSV and too few rows, and stores nothing", async () => {
    await expect(ingestDataset({ name: "c", kind: "decision", filename: "x.csv", content: "a,b\n1,2" })).rejects.toThrow(/JSONL or a JSON array/);
    await expect(ingestDataset({ name: "few", kind: "decision", content: decisionRows(5) })).rejects.toThrow(/at least 20/);
    expect(tl.datasets).toEqual([]);
  });

  it("saves to S3 as train.jsonl + eval.jsonl under a prefix the decision trainer reads", async () => {
    const r = await ingestDataset({
      name: "s3 tickets",
      kind: "decision",
      content: decisionRows(30),
      evalContent: decisionRows(10),
      destination: { kind: "s3", bucket: "sft", prefix: "decision" },
    });
    expect(r.ref).toBe("s3://sft/decision/s3-tickets/");
    expect(s3.puts.map((p) => p.key)).toEqual(["decision/s3-tickets/train.jsonl", "decision/s3-tickets/eval.jsonl"]);
  });

  it("registers the test file of a dataset with a very long name under a shortened id", async () => {
    const long = "a".repeat(120);
    const r = await ingestDataset({ name: long, kind: "decision", content: decisionRows(30), evalContent: decisionRows(10) });
    expect(r.id).toBe(long);
    expect(r.evalSetId).toBeDefined();
    expect(r.evalSetId!.length).toBeLessThanOrEqual(81);
    expect(r.evalSetError).toBeUndefined();
  });

  it("never replaces an existing test set with the same id", async () => {
    const { addDecisionEvalSet, readDecisionEvalSet } = await import("@/lib/decision-eval-set-store");
    await addDecisionEvalSet({ name: "Clash", content: decisionRows(7), source: "upload" });
    const r = await ingestDataset({ name: "clash", kind: "decision", content: decisionRows(30), evalContent: decisionRows(10) });
    expect(r.evalSetId).toBe("clash-test");
    expect((await readDecisionEvalSet("clash"))!.meta.rows).toBe(7);
  });
});
