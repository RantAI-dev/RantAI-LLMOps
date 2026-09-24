import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * Every API route, swept twice: once with no session to prove the gate holds,
 * and once signed in to prove the handler answers and validates its input.
 *
 * The browser suites exercise the paths a person walks; this one covers the
 * endpoints behind the buttons nobody clicked, including the destructive ones
 * (delete, stop, reconcile) that are easiest to break unnoticed.
 *
 * Nothing here starts a GPU job or downloads a model: every write is either
 * rejected at validation or reverted in the same test.
 */
const BASE = process.env.BASE_URL ?? "http://10.17.254.27:3000";

/** GET routes that must answer 200 for a signed-in caller. */
const READ_ROUTES = [
  "/api/adapters",
  "/api/compute/gpu-metrics",
  "/api/compute/providers",
  "/api/conversations",
  "/api/dashboard/inference-stats",
  "/api/datasets/list",
  "/api/datasets/s3-config",
  "/api/evals/classification",
  "/api/evals/grounding",
  "/api/evals/jobs",
  "/api/evals/options",
  "/api/finetune/jobs",
  "/api/finetune/options",
  "/api/hub/base-models",
  "/api/hub/datasets",
  "/api/hub/models",
  "/api/models",
  "/api/models/catalog",
  "/api/notes",
  "/api/prompts",
  "/api/serve/gateway",
  "/api/serve/info",
  "/api/serve/vllm",
  "/api/settings",
  "/api/tasks/list",
  "/api/traces",
  "/api/workflows/runs",
];

/** POST routes and the field each one must insist on. */
const REQUIRED_FIELD = [
  { path: "/api/chat", missing: /messages/i },
  { path: "/api/datasets/delete", missing: /datasetId/i },
  { path: "/api/evals/submit", missing: /model|benchmark/i },
  { path: "/api/finetune/export", missing: /fusedModelId/i },
  { path: "/api/finetune/submit", missing: /baseModel|dataset|adaptorName/i },
  { path: "/api/generations/complete", missing: /prompt/i },
  { path: "/api/models/delete", missing: /modelIds/i },
  { path: "/api/models/download", missing: /model/i },
  { path: "/api/models/load", missing: /modelId/i },
];

/** Routes that must never be reachable without a session. */
const GATED = [
  ...READ_ROUTES,
  "/api/tasks/does-not-exist/output",
  "/api/prompts/does-not-exist",
  "/api/notes/does-not-exist",
];

test.describe("Auth gate", () => {
  test("every route refuses an unauthenticated caller", async ({ playwright }) => {
    // `use.storageState` in the config applies to contexts created here too, so
    // the session has to be cleared explicitly — otherwise this "anonymous"
    // caller silently carries the suite's cookie and every route looks open.
    const anon: APIRequestContext = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const leaks: string[] = [];

    for (const path of GATED) {
      const res = await anon.get(BASE + path);
      if (res.status() !== 401) leaks.push(`GET ${path} -> ${res.status()}`);
    }
    for (const { path } of REQUIRED_FIELD) {
      const res = await anon.post(BASE + path, { data: {} });
      if (res.status() !== 401) leaks.push(`POST ${path} -> ${res.status()}`);
    }
    for (const path of ["/api/adapters/reconcile", "/api/serve/vllm/stop"]) {
      const res = await anon.post(BASE + path, { data: {} });
      if (res.status() !== 401) leaks.push(`POST ${path} -> ${res.status()}`);
    }

    await anon.dispose();
    expect(leaks, `routes reachable while signed out:\n${leaks.join("\n")}`).toHaveLength(0);
  });
});

test.describe("Read routes answer", () => {
  for (const path of READ_ROUTES) {
    test(`GET ${path}`, async ({ request }) => {
      const res = await request.get(BASE + path);
      expect(res.status(), await res.text()).toBe(200);
      // A 200 that is not JSON means a handler fell through to an HTML error page.
      expect(res.headers()["content-type"] ?? "").toMatch(/json/);
    });
  }
});

test.describe("Config-dependent routes report cleanly", () => {
  // The grounding eval sets live in an S3 bucket that S3_ALLOWED_BUCKETS does not
  // permit on this deployment. The handler must say so in JSON rather than crash.
  test("GET /api/evals/grounding/eval-sets explains a blocked bucket", async ({ request }) => {
    const res = await request.get(`${BASE}/api/evals/grounding/eval-sets`);
    expect([200, 502]).toContain(res.status());
    const body = await res.text();
    expect(body).toMatch(/^\{/);
    if (res.status() === 502) expect(body).toMatch(/bucket|S3_ALLOWED_BUCKETS/i);
  });
});

test.describe("Write routes validate their input", () => {
  for (const { path, missing } of REQUIRED_FIELD) {
    test(`POST ${path} rejects an empty body`, async ({ request }) => {
      const res = await request.post(BASE + path, { data: {} });
      expect(res.status()).toBe(400);
      expect(await res.text()).toMatch(missing);
    });
  }

  test("malformed JSON is rejected, not crashed on", async ({ request }) => {
    const res = await request.post(`${BASE}/api/finetune/submit`, {
      headers: { "Content-Type": "application/json" },
      data: "{not json",
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("Destructive routes refuse unknown ids", () => {
  test("deleting a dataset that does not exist does not 500", async ({ request }) => {
    const res = await request.post(`${BASE}/api/datasets/delete`, {
      data: { datasetId: "definitely-no-such-dataset-xyz" },
    });
    expect(res.status()).toBeLessThan(500);
  });

  test("deleting a model that does not exist does not 500", async ({ request }) => {
    const res = await request.post(`${BASE}/api/models/delete`, {
      data: { modelIds: ["definitely-no-such-model-xyz"] },
    });
    expect(res.status()).toBeLessThan(500);
  });

  test("exporting an unknown fine-tune does not 500", async ({ request }) => {
    const res = await request.post(`${BASE}/api/finetune/export`, {
      data: { fusedModelId: "definitely-no-such-job-xyz" },
    });
    expect(res.status()).toBeLessThan(500);
  });

  test("a note id outside the notes namespace is refused", async ({ request }) => {
    // The handler guards the namespace rather than existence: an id without the
    // note prefix is 404, which is what stops it reading a real job experiment.
    const res = await request.get(`${BASE}/api/notes/definitely-no-such-note-xyz`);
    expect(res.status()).toBe(404);
  });

  test("a prompt id that does not exist reads as 404", async ({ request }) => {
    const res = await request.get(`${BASE}/api/prompts/definitely-no-such-prompt-xyz`);
    expect(res.status()).toBe(404);
  });
});

test.describe("Notes round-trip", () => {
  test("create, read, update and delete", async ({ request }) => {
    const title = `api-${Date.now().toString(36)}`;
    const created = await request.post(`${BASE}/api/notes`, { data: { title } });
    expect(created.status(), await created.text()).toBe(200);
    const id = (await created.json())?.note?.id;
    expect(id, "create returned no id").toBeTruthy();

    const read = await request.get(`${BASE}/api/notes/${encodeURIComponent(id)}`);
    expect(read.status()).toBe(200);

    // The body field is `content`, and saving must round-trip.
    const saved = await request.put(`${BASE}/api/notes/${encodeURIComponent(id)}`, {
      data: { content: "# diubah oleh uji API" },
    });
    expect(saved.status()).toBeLessThan(400);
    expect(await (await request.get(`${BASE}/api/notes/${encodeURIComponent(id)}`)).text()).toMatch(
      /diubah oleh uji API/,
    );

    const removed = await request.delete(`${BASE}/api/notes/${encodeURIComponent(id)}`);
    expect(removed.status()).toBeLessThan(300);

    // GET only namespaces the id; a deleted note reads back as empty content
    // rather than 404, so assert the content is gone and it left the list.
    const gone = await request.get(`${BASE}/api/notes/${encodeURIComponent(id)}`);
    expect(await gone.text()).not.toMatch(/diubah oleh uji API/);
    const list = await (await request.get(`${BASE}/api/notes`)).text();
    expect(list).not.toContain(id);
  });
});

test.describe("Prompt versions", () => {
  test("a new version is recorded and listed", async ({ request }) => {
    const name = `api-${Date.now().toString(36)}-prompt`;
    const created = await request.post(`${BASE}/api/prompts`, {
      data: { name, text: "Versi pertama." },
    });
    expect(created.status(), await created.text()).toBe(201);
    const id = (await created.json())?.prompt?.id;
    expect(id, "create returned no prompt id").toBeTruthy();

    // /versions is POST-only: it ADDS a version. Empty text must be refused.
    const blank = await request.post(`${BASE}/api/prompts/${encodeURIComponent(id)}/versions`, {
      data: { text: "   " },
    });
    expect(blank.status()).toBe(400);

    const v2 = await request.post(`${BASE}/api/prompts/${encodeURIComponent(id)}/versions`, {
      data: { text: "Versi kedua.", note: "dari uji API" },
    });
    expect(v2.status(), await v2.text()).toBeLessThan(300);

    // The prompt now carries both versions.
    const read = await request.get(`${BASE}/api/prompts/${encodeURIComponent(id)}`);
    expect(read.status()).toBe(200);
    const detail = await read.text();
    expect(detail).toMatch(/Versi kedua/);

    await request.delete(`${BASE}/api/prompts/${encodeURIComponent(id)}`);
  });
});

test.describe("Session", () => {
  test("logout invalidates the session", async ({ playwright }) => {
    const password = process.env.APP_PASSWORD ?? "";
    // Start genuinely signed out, or the post-logout assertion would be met by
    // the suite's own inherited cookie rather than by a fresh login.
    const ctx = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const login = await ctx.post(`${BASE}/api/auth/login`, { data: { password } });
    // Skip rather than fail if this run has spent its rate-limit window.
    if (login.status() === 429) {
      await ctx.dispose();
      test.skip();
      return;
    }
    expect(login.status()).toBe(200);
    expect((await ctx.get(`${BASE}/api/tasks/list`)).status()).toBe(200);

    const out = await ctx.post(`${BASE}/api/auth/logout`, { data: {} });
    expect(out.status()).toBeLessThan(400);
    expect((await ctx.get(`${BASE}/api/tasks/list`)).status()).toBe(401);
    await ctx.dispose();
  });
});
