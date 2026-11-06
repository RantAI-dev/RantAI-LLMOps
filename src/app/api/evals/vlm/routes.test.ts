// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  denied: null as Response | null,
  engines: [] as Array<Record<string, unknown>>,
  textOnly: false,
  sglangError: undefined as string | undefined,
}));
vi.mock("@/lib/auth", () => ({ guardApi: vi.fn(async () => mocks.denied) }));
vi.mock("@/lib/log", () => ({ logServerError: vi.fn() }));
vi.mock("@/lib/inference-engines", () => ({
  resolveEngine: (id?: string) => {
    const engineId = id === "vllm" || id === "sglang" ? id : "ollama";
    const configured = engineId !== "sglang";
    return {
      id: engineId,
      label: engineId === "vllm" ? "vLLM" : engineId === "sglang" ? "SGLang" : "Ollama",
      v1BaseUrl: configured ? `http://${engineId}/v1` : "",
      configured,
      headers: { "Content-Type": "application/json" },
    };
  },
  engineUrlVar: (id: string) => (id === "sglang" ? "SGLANG_BASE_URL" : "X"),
  listEngines: vi.fn(async () => mocks.engines),
  modelKnownTextOnly: vi.fn(async () => mocks.textOnly),
  engineRequestModel: vi.fn(async (_e: unknown, model: string) => (mocks.sglangError ? { model, error: mocks.sglangError } : { model: `wire-${model}` })),
}));

import { GET as getRun, DELETE as deleteRun } from "@/app/api/evals/vlm/[id]/route";
import { GET as listRuns, POST as startRun } from "@/app/api/evals/vlm/route";
import { GET as getSet, DELETE as deleteSet } from "@/app/api/evals/vlm/sets/[id]/route";
import { GET as getImage } from "@/app/api/evals/vlm/sets/[id]/image/route";
import { GET as listSets, POST as addSet } from "@/app/api/evals/vlm/sets/route";
import { readVlmEvalRun } from "@/lib/vlm-eval-store";
import { makeZip } from "@/lib/vlm-eval-test-helpers";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "rantai-vlm-routes-"));
  process.env.RANTAI_DATA_DIR = dir;
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.RANTAI_DATA_DIR;
  vi.unstubAllGlobals();
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (p: string, init?: RequestInit) => new NextRequest(`http://localhost${p}`, init);
const json = (p: string, body: unknown, method = "POST") => req(p, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

const vllm = (models: Array<Record<string, unknown>> = [{ id: "base", name: "base", vision: true }, { id: "ask", name: "ask", parent: "base" }]) => ({
  id: "vllm",
  available: true,
  models,
});

beforeEach(() => {
  mocks.denied = null;
  mocks.textOnly = false;
  mocks.sglangError = undefined;
  mocks.engines = [vllm()];
  vi.unstubAllGlobals();
});

async function addTestSet(name = "latex test", scoring = "exact", zip = makeZip({ n: 6 })) {
  const form = new FormData();
  form.append("name", name);
  form.append("scoring", scoring);
  form.append("file", new Blob([zip as BlobPart]), "set.zip");
  return addSet(req("/api/evals/vlm/sets", { method: "POST", body: form }));
}

describe("auth guard", () => {
  it("answers 401 on every route when the caller is not signed in", async () => {
    mocks.denied = Response.json({ error: "Unauthorized" }, { status: 401 });
    const calls: Array<Promise<Response>> = [
      listRuns(req("/api/evals/vlm")),
      startRun(json("/api/evals/vlm", {})),
      getRun(req("/api/evals/vlm/x"), ctx("x")),
      deleteRun(req("/api/evals/vlm/x", { method: "DELETE" }), ctx("x")),
      listSets(req("/api/evals/vlm/sets")),
      addTestSet(),
      getSet(req("/api/evals/vlm/sets/x"), ctx("x")),
      deleteSet(req("/api/evals/vlm/sets/x", { method: "DELETE" }), ctx("x")),
      getImage(req("/api/evals/vlm/sets/x/image?path=images/a.png"), ctx("x")),
    ];
    for (const res of await Promise.all(calls)) expect(res.status).toBe(401);
  });
});

describe("sets", () => {
  it("adds a set from a ZIP, lists it, shows a preview, serves a thumbnail and deletes it", async () => {
    const res = await addTestSet("My Formulas", "latex");
    expect(res.status).toBe(200);
    const { set } = await res.json();
    expect(set).toMatchObject({ id: "my-formulas", scoring: "latex", rows: 6, images: 6 });

    expect((await (await listSets(req("/api/evals/vlm/sets"))).json()).sets.map((s: { id: string }) => s.id)).toContain("my-formulas");
    const detail = await (await getSet(req("/api/evals/vlm/sets/my-formulas"), ctx("my-formulas"))).json();
    expect(detail.set.id).toBe("my-formulas");
    expect(detail.preview).toHaveLength(6);
    expect(detail.preview[0]).toMatchObject({ id: 0, images: ["images/img0.png"] });

    const img = await getImage(req("/api/evals/vlm/sets/my-formulas/image?path=images%2Fimg0.png"), ctx("my-formulas"));
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("x-content-type-options")).toBe("nosniff");
    expect(img.headers.get("content-security-policy")).toBe("default-src 'none'");

    expect((await deleteSet(req("/api/evals/vlm/sets/my-formulas", { method: "DELETE" }), ctx("my-formulas"))).status).toBe(200);
    expect((await getSet(req("/api/evals/vlm/sets/my-formulas"), ctx("my-formulas"))).status).toBe(404);
  });

  it("limits the preview to 8 rows", async () => {
    await addTestSet("big preview", "exact", makeZip({ n: 12 }));
    const detail = await (await getSet(req("/api/evals/vlm/sets/big-preview"), ctx("big-preview"))).json();
    expect(detail.set.rows).toBe(12);
    expect(detail.preview).toHaveLength(8);
  });

  it("answers 400 for a missing name, file or scoring, 409 for a taken name, and the reason for a bad ZIP", async () => {
    const form = (fields: Record<string, string | Blob>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries(fields)) f.append(k, v);
      return req("/api/evals/vlm/sets", { method: "POST", body: f });
    };
    const zip = new Blob([makeZip() as BlobPart]);
    expect((await addSet(form({ scoring: "exact", file: zip }))).status).toBe(400);
    expect((await addSet(form({ name: "n", scoring: "exact" }))).status).toBe(400);
    const badScoring = await addSet(form({ name: "n", scoring: "fuzzy", file: zip }));
    expect(badScoring.status).toBe(400);
    expect((await badScoring.json()).error).toMatch(/Scoring must be one of/);
    expect((await addSet(req("/api/evals/vlm/sets", { method: "POST", body: "plain", headers: { "content-type": "text/plain" } }))).status).toBe(400);
    expect((await addTestSet("taken once")).status).toBe(200);
    expect((await addTestSet("taken once")).status).toBe(409);
    const broken = await addTestSet("broken", "exact", makeZip({ n: 6, rows: [JSON.stringify({ messages: [{ role: "user", content: [{ type: "image", image: "images/gone.png" }] }, { role: "assistant", content: "a" }] })] }));
    expect(broken.status).toBe(400);
    expect((await broken.json()).error).toContain("images/gone.png");
  });

  it("refuses an upload whose declared size is over the cap, before reading it", async () => {
    const r = req("/api/evals/vlm/sets", { method: "POST", body: new FormData(), headers: { "content-length": String(300 * 1024 * 1024) } });
    expect((await addSet(r)).status).toBe(413);
  });

  it("is 400 for an unsafe id and 404 for an image outside the set", async () => {
    expect((await getSet(req("/api/evals/vlm/sets/..%2Fx"), ctx("../x"))).status).toBe(400);
    expect((await deleteSet(req("/api/evals/vlm/sets/..%2Fx", { method: "DELETE" }), ctx("../x"))).status).toBe(400);
    await addTestSet("img guard");
    for (const p of ["images/../meta.json", "meta.json", "images/none.png", ""]) {
      expect((await getImage(req(`/api/evals/vlm/sets/img-guard/image?path=${encodeURIComponent(p)}`), ctx("img-guard"))).status).toBe(404);
    }
    expect((await getImage(req("/api/evals/vlm/sets/..%2Fx/image?path=images/a.png"), ctx("../x"))).status).toBe(404);
  });
});

describe("starting a run", () => {
  const fakeEngine = () =>
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      const prompt = body.messages.at(-1).content.at(-1).text as string; // "What is in image N?"
      const i = /image (\d+)/.exec(prompt)![1];
      return Response.json({ choices: [{ message: { content: i === "3" ? "wrong" : `k${i}` }, finish_reason: "stop" }], usage: { completion_tokens: 3 } });
    });

  async function waitDone(id: string) {
    for (let i = 0; i < 200; i++) {
      const run = await readVlmEvalRun(id);
      if (run && run.status !== "running") return run;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("run did not finish");
  }

  it("runs the set on the model, detached, and the report is readable afterwards", async () => {
    await addTestSet("run set");
    const fetchMock = fakeEngine();
    vi.stubGlobal("fetch", fetchMock);
    const res = await startRun(json("/api/evals/vlm", { engine: "vllm", model: "base", setId: "run-set", maxTokens: 64 }));
    expect(res.status).toBe(200);
    const { runId } = await res.json();
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);

    const run = await waitDone(runId);
    expect(run).toMatchObject({ status: "done", setId: "run-set", model: "base", engine: "vllm", scoring: "exact", maxTokens: 64 });
    expect(run.report).toMatchObject({ scored: 6, correct: 5 });
    // The wire name is what the engine layer mapped it to; the record keeps the name the person picked.
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).model).toBe("wire-base");

    const got = await (await getRun(req(`/api/evals/vlm/${runId}`), ctx(runId))).json();
    expect(got.run.cases).toHaveLength(6);
    const list = await (await listRuns(req("/api/evals/vlm"))).json();
    const summary = list.runs.find((r: { id: string }) => r.id === runId);
    expect(summary).toBeDefined();
    expect("cases" in summary).toBe(false);
    expect(list.sets.map((s: { id: string }) => s.id)).toContain("run-set");

    expect((await deleteRun(req(`/api/evals/vlm/${runId}`, { method: "DELETE" }), ctx(runId))).status).toBe(200);
    expect((await getRun(req(`/api/evals/vlm/${runId}`), ctx(runId))).status).toBe(404);
  });

  it("validates the body", async () => {
    await addTestSet("body set");
    const post = (b: unknown) => startRun(json("/api/evals/vlm", b));
    expect((await post({ engine: "vllm", setId: "body-set" })).status).toBe(400);
    expect((await post({ engine: "vllm", model: "base" })).status).toBe(400);
    for (const maxTokens of [0, -1, 1.5, 100000, "abc"]) {
      expect((await post({ engine: "vllm", model: "base", setId: "body-set", maxTokens })).status).toBe(400);
    }
    expect((await startRun(req("/api/evals/vlm", { method: "POST", body: "nope" }))).status).toBe(400);
    expect((await post({ engine: "vllm", model: "base", setId: "no-such-set" })).status).toBe(404);
    expect((await post({ engine: "vllm", model: "base", setId: "../x" })).status).toBe(400);
  });

  it("refuses an engine that is not configured, not reachable, or a model that is not served", async () => {
    await addTestSet("engine set");
    const body = { engine: "vllm", model: "base", setId: "engine-set" };
    const notConfigured = await startRun(json("/api/evals/vlm", { ...body, engine: "sglang" }));
    expect(notConfigured.status).toBe(404);
    expect((await notConfigured.json()).error).toMatch(/not configured.*SGLANG_BASE_URL/);

    mocks.engines = [{ ...vllm(), available: false }];
    expect((await startRun(json("/api/evals/vlm", body))).status).toBe(502);

    mocks.engines = [vllm()];
    const unserved = await startRun(json("/api/evals/vlm", { ...body, model: "ghost" }));
    expect(unserved.status).toBe(400);
    expect((await unserved.json()).error).toMatch(/"ghost" is not served.*Served: base, ask/);
  });

  it("refuses a model that is KNOWN to be text-only, but lets an unknown one through", async () => {
    await addTestSet("vision set");
    const body = { engine: "vllm", model: "base", setId: "vision-set" };
    mocks.engines = [vllm([{ id: "base", name: "base", vision: false }])];
    const known = await startRun(json("/api/evals/vlm", body));
    expect(known.status).toBe(400);
    expect((await known.json()).error).toMatch(/text-only/);

    mocks.engines = [vllm([{ id: "base", name: "base" }])];
    mocks.textOnly = true; // the engine layer also says so (Ollama capabilities)
    expect((await startRun(json("/api/evals/vlm", body))).status).toBe(400);

    mocks.textOnly = false;
    vi.stubGlobal("fetch", fakeEngine());
    const unknown = await startRun(json("/api/evals/vlm", body));
    expect(unknown.status).toBe(200);
    await waitDone((await unknown.json()).runId);
  });

  it("refuses a name SGLang would silently answer with the base model", async () => {
    await addTestSet("sglang set");
    mocks.sglangError = 'SGLang does not serve "ask" (serving: base).';
    const res = await startRun(json("/api/evals/vlm", { engine: "vllm", model: "ask", setId: "sglang-set" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/does not serve/);
  });

  it("records a failed run when the engine errors on every row", async () => {
    await addTestSet("down set");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    const { runId } = await (await startRun(json("/api/evals/vlm", { engine: "vllm", model: "base", setId: "down-set" }))).json();
    const run = await waitDone(runId);
    expect(run.status).toBe("error");
    expect(run.error).toMatch(/No row could be scored.*500/);
  });

  it("is 400 for an unsafe run id", async () => {
    expect((await getRun(req("/api/evals/vlm/x"), ctx("../../x"))).status).toBe(400);
    expect((await deleteRun(req("/api/evals/vlm/x", { method: "DELETE" }), ctx("../../x"))).status).toBe(400);
  });
});
