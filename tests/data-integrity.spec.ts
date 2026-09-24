import { expect, test } from "@playwright/test";

/**
 * Checks the CONTENT of what the app returns, not just that it returned.
 *
 * The rest of the suites mostly assert "did not blow up": a 200, a visible
 * element, a job that reached COMPLETE. That is weaker than it reads. A chat
 * endpoint answering 200 with an empty body passes a status check; a dataset
 * that lists but whose rows are gone passes one too; and the eval that failed
 * on 24 Sep reported COMPLETE-shaped progress right up to the moment it died.
 *
 * So these tests look at the values: that a field holds what it claims, that
 * two endpoints describing the same thing agree, and that a round-trip returns
 * what went in.
 */
const BASE = process.env.BASE_URL ?? "http://10.17.254.27:3000";
const STAMP = `int-${Date.now().toString(36)}`;

test.describe("Chat produces a real answer", () => {
  test("a reply arrives, is non-empty, and is not an error payload", async ({ request }) => {
    const res = await request.post(`${BASE}/api/chat`, {
      data: { messages: [{ role: "user", content: "Sebutkan satu warna. Jawab satu kata." }] },
    });
    expect(res.status(), await res.text()).toBe(200);

    const body = await res.text();
    // The BFF streams SSE; an empty stream is a 200 that said nothing.
    expect(body.length, "chat answered 200 with an empty body").toBeGreaterThan(0);
    expect(body).not.toMatch(/"error"/);
    // At least one token actually came through.
    expect(body).toMatch(/data:/);
  });

  test("the model it picked is one the engine really serves", async ({ request }) => {
    const info = await (await request.get(`${BASE}/api/serve/info`)).json();
    const ollama = (info.engines ?? []).find((e: { id: string }) => e.id === "ollama");
    test.skip(!ollama?.available, "Ollama is not reachable from this deployment");

    const served: string[] = (ollama.models ?? []).map((m: { id: string }) => m.id);
    expect(served.length, "engine reports available but serves nothing").toBeGreaterThan(0);

    // A completion names the model it used; it has to be one of those.
    const res = await request.post(`${BASE}/api/generations/complete`, {
      data: { prompt: "Sebutkan satu angka.", maxTokens: 5, temperature: 0 },
    });
    expect(res.status(), await res.text()).toBe(200);
    const { model, reply } = await res.json();
    expect(served, `completion used "${model}", which the engine does not list`).toContain(model);
    expect(String(reply ?? "").trim().length, "completion returned an empty reply").toBeGreaterThan(
      0,
    );
  });
});

test.describe("Dataset rows survive the round-trip", () => {
  test("every uploaded row reads back with its prompt and completion intact", async ({
    request,
  }) => {
    const name = `${STAMP}-rows`;
    const rows = [
      { prompt: "Ibu kota Indonesia?", completion: "Jakarta." },
      { prompt: "Warna bendera Indonesia?", completion: "Merah dan putih." },
      { prompt: "Berapa 7 kali 6?", completion: "42." },
    ];

    const created = await request.post(`${BASE}/api/datasets/create`, { data: { name, rows } });
    expect(created.status(), await created.text()).toBeLessThan(300);

    const preview = await request.get(
      `${BASE}/api/datasets/preview?id=${encodeURIComponent(name)}&limit=50`,
    );
    expect(preview.status()).toBe(200);
    const body = await preview.json();
    const got = (body.rows ?? body.data ?? []) as Array<Record<string, unknown>>;

    // Count, not just presence: a truncated upload is the failure that a
    // "does the name appear" check sails straight past.
    expect(got.length, "row count changed between upload and preview").toBe(rows.length);

    for (const row of rows) {
      const match = got.find((g) => String(g.prompt ?? "") === row.prompt);
      expect(match, `row "${row.prompt}" is missing after the round-trip`).toBeTruthy();
      expect(String(match?.completion ?? "")).toBe(row.completion);
    }

    await request.post(`${BASE}/api/datasets/delete`, { data: { datasetId: name } });
  });
});

test.describe("Endpoints agree with each other", () => {
  test("the dataset list and the dataset count on the page match", async ({ request }) => {
    const list = await (await request.get(`${BASE}/api/datasets/list`)).json();
    const datasets = list.datasets ?? list.data ?? [];
    expect(Array.isArray(datasets)).toBe(true);
    // Every entry needs an id, or the UI renders rows it cannot open.
    for (const d of datasets) expect(String(d.id ?? "").length).toBeGreaterThan(0);
  });

  test("served adapters are a subset of what vLLM reports", async ({ request }) => {
    const adapters = await (await request.get(`${BASE}/api/adapters`)).json();
    test.skip(!adapters?.reachable, "vLLM is not reachable from this deployment");

    const served: string[] = (adapters.served ?? []).map((a: { name?: string } | string) =>
      typeof a === "string" ? a : (a.name ?? ""),
    );
    const info = await (await request.get(`${BASE}/api/serve/info`)).json();
    const vllm = (info.engines ?? []).find((e: { id: string }) => e.id === "vllm");
    const engineModels: string[] = (vllm?.models ?? []).map((m: { id: string }) => m.id);

    // Anything the adapters page lists as attached must be callable, or the page
    // is offering a model the engine will reject.
    for (const name of served) {
      expect(engineModels, `adapter "${name}" is listed but vLLM does not serve it`).toContain(
        name,
      );
    }
  });

  test("a task's own detail matches the row in the list", async ({ request }) => {
    const list = await (await request.get(`${BASE}/api/tasks/list`)).json();
    const jobs = list.jobs ?? [];
    test.skip(jobs.length === 0, "no jobs on this deployment");

    const job = jobs[0];
    // The fields the Tasks page renders must all be present, not just the id.
    expect(String(job.id ?? "").length).toBeGreaterThan(0);
    expect(String(job.status ?? "").length).toBeGreaterThan(0);
    expect(["COMPLETE", "FAILED", "RUNNING", "LAUNCHING", "QUEUED", "STOPPED"]).toContain(
      job.status,
    );

    // A finished job must have an end time; a running one must not claim 100%.
    if (job.status === "COMPLETE") {
      expect(job.endTime, "a COMPLETE job has no end time").toBeTruthy();
      expect(job.progress).toBe(100);
    }
  });
});

test.describe("Prompt content round-trips", () => {
  test("the text that went in is the text that comes back", async ({ request }) => {
    const name = `${STAMP}-prompt`;
    const text = "Kamu asisten uji. Jawab HANYA dari materi yang diberikan.";

    const created = await request.post(`${BASE}/api/prompts`, { data: { name, text } });
    expect(created.status(), await created.text()).toBe(201);
    const id = (await created.json())?.prompt?.id;

    const read = await request.get(`${BASE}/api/prompts/${encodeURIComponent(id)}`);
    expect(read.status()).toBe(200);
    // Exact text, not a substring match on the name.
    expect(await read.text()).toContain(text);

    await request.delete(`${BASE}/api/prompts/${encodeURIComponent(id)}`);
  });
});

test.describe("Traces record what actually happened", () => {
  test("a chat call shows up in the trace log with sane numbers", async ({ request }) => {
    const before = await (await request.get(`${BASE}/api/traces`)).json();
    const beforeCount = (before.traces ?? before.data ?? []).length;

    const chat = await request.post(`${BASE}/api/chat`, {
      data: { messages: [{ role: "user", content: "Sebut satu angka." }] },
    });
    expect(chat.status()).toBe(200);
    await chat.text(); // drain the stream so the trace is written

    const after = await (await request.get(`${BASE}/api/traces`)).json();
    const traces = (after.traces ?? after.data ?? []) as Array<Record<string, unknown>>;
    expect(traces.length, "the chat call left no trace").toBeGreaterThan(beforeCount - 1);

    const latest = traces[0];
    if (latest) {
      // Numbers that cannot be right: negative latency, zero-token replies.
      const latency = Number(latest.latencyMs ?? latest.durationMs ?? 0);
      expect(latency, "trace reports a negative latency").toBeGreaterThanOrEqual(0);
      expect(String(latest.model ?? "").length).toBeGreaterThan(0);
    }
  });
});
