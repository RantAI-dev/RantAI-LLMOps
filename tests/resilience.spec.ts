import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * What the app does when its dependencies are down.
 *
 * Every other suite runs against a healthy deployment, so all of them describe
 * the same happy world. This one breaks things on purpose — stops Ollama, stops
 * the backend — and asserts the app degrades honestly: a clear error, a page
 * that still renders, a status that says "unreachable" rather than pretending.
 *
 * THIS SUITE STOPS REAL CONTAINERS. Each test restarts what it stopped in a
 * `finally`, and `afterAll` restores everything regardless of how a test ended.
 * Run it only against a deployment nobody is using.
 *
 *   APP_PASSWORD=... BASE_URL=... npx playwright test tests/resilience.spec.ts
 */
const BASE = process.env.BASE_URL ?? "http://10.17.254.27:3000";
const PORTAINER = process.env.PORTAINER_URL ?? "https://10.17.254.27:9443";
const PORTAINER_USER = process.env.PORTAINER_USER ?? "";
const PORTAINER_PASSWORD = process.env.PORTAINER_PASSWORD ?? "";
const ENDPOINT = process.env.PORTAINER_ENDPOINT ?? "3";

/** Containers this suite is allowed to touch, and nothing else. */
const TOUCHABLE = ["ollama", "rantai-backend"] as const;
type Touchable = (typeof TOUCHABLE)[number];

let docker: APIRequestContext;
let token = "";
let csrf = "";

async function portainer(path: string, method: "GET" | "POST" = "GET") {
  const url = `${PORTAINER}/api/endpoints/${ENDPOINT}/docker${path}`;
  // Portainer guards state-changing calls twice: it refuses a request with no
  // Referer ("referer not supplied"), then one with no CSRF token. The token
  // comes back on any GET as the x-csrf-token header.
  const opts = {
    headers: {
      Authorization: `Bearer ${token}`,
      Referer: PORTAINER,
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    },
  };
  return method === "POST" ? docker.post(url, opts) : docker.get(url, opts);
}

async function containerState(name: Touchable): Promise<string> {
  const res = await portainer(`/containers/${name}/json`);
  if (!res.ok()) return "unknown";
  return (await res.json())?.State?.Status ?? "unknown";
}

async function stop(name: Touchable) {
  expect(TOUCHABLE, `refusing to stop ${name}`).toContain(name);
  const res = await portainer(`/containers/${name}/stop?t=10`, "POST");
  // 204 stopped, 304 already stopped. Anything else means the call was refused
  // and the poll below would otherwise just time out with no explanation.
  expect([204, 304], `stop ${name} was refused: ${await res.text()}`).toContain(res.status());
  await expect
    .poll(() => containerState(name), { timeout: 60_000 })
    .not.toBe("running");
}

async function start(name: Touchable) {
  const res = await portainer(`/containers/${name}/start`, "POST");
  expect([204, 304], `start ${name} was refused: ${await res.text()}`).toContain(res.status());
  await expect.poll(() => containerState(name), { timeout: 90_000 }).toBe("running");
}

test.beforeAll(async ({ playwright }) => {
  test.skip(
    !PORTAINER_USER || !PORTAINER_PASSWORD,
    "PORTAINER_USER / PORTAINER_PASSWORD are required: this suite stops containers",
  );
  docker = await playwright.request.newContext({ ignoreHTTPSErrors: true });
  const auth = await docker.post(`${PORTAINER}/api/auth`, {
    data: { Username: PORTAINER_USER, Password: PORTAINER_PASSWORD },
  });
  expect(auth.status(), "could not authenticate to Portainer").toBe(200);
  token = (await auth.json()).jwt;

  const probe = await docker.get(`${PORTAINER}/api/status`, {
    headers: { Authorization: `Bearer ${token}`, Referer: PORTAINER },
  });
  csrf = probe.headers()["x-csrf-token"] ?? "";
  expect(csrf, "Portainer issued no CSRF token; stop/start would be refused").toBeTruthy();
});

test.afterAll(async () => {
  // Whatever happened above, leave the box as we found it.
  if (token) for (const name of TOUCHABLE) await start(name).catch(() => {});
  await docker?.dispose();
});

test.describe.configure({ mode: "serial" });

test.describe("Ollama is down", () => {
  test("the app says so instead of pretending", async ({ request, page }) => {
    try {
      await stop("ollama");

      // serve/info must report it unavailable — not omit it, not claim it is up.
      const info = await (await request.get(`${BASE}/api/serve/info`)).json();
      const ollama = (info.engines ?? []).find((e: { id: string }) => e.id === "ollama");
      expect(ollama, "the engine disappeared from serve/info entirely").toBeTruthy();
      expect(ollama.available, "Ollama is stopped but still reports available").toBe(false);

      // Chat must fail with a message, not hang or return an empty 200.
      const chat = await request.post(`${BASE}/api/chat`, {
        data: { messages: [{ role: "user", content: "hai" }] },
      });
      expect(chat.status(), "chat answered 200 while its engine was down").not.toBe(200);
      expect(await chat.text()).toMatch(/^\{/);

      // The page still renders, with the engine shown as unreachable.
      await page.goto(`${BASE}/serve`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 25_000 });
      await expect(page.locator("body")).not.toContainText(/Application error|Unhandled Runtime/i);
      await expect(page.locator("body")).toContainText(/unreachable|offline|not reachable/i, {
        timeout: 25_000,
      });
    } finally {
      await start("ollama");
    }
  });

  test("recovers on its own once Ollama is back", async ({ request }) => {
    // No restart of the app: it must notice the engine returning by itself.
    await expect
      .poll(
        async () => {
          const info = await (await request.get(`${BASE}/api/serve/info`)).json();
          return (info.engines ?? []).find((e: { id: string }) => e.id === "ollama")?.available;
        },
        { timeout: 90_000, message: "Ollama came back but the app still reports it down" },
      )
      .toBe(true);

    const chat = await request.post(`${BASE}/api/chat`, {
      data: { messages: [{ role: "user", content: "hai" }] },
    });
    expect(chat.status()).toBe(200);
  });
});

test.describe("The backend is down", () => {
  test("data pages fail loudly and the shell still renders", async ({ request, page }) => {
    try {
      await stop("rantai-backend");

      // Anything sourced from the backend must error, not answer with an empty
      // list — an empty list reads as "you have no data", which is a lie.
      for (const path of ["/api/tasks/list", "/api/datasets/list"]) {
        const res = await request.get(`${BASE}${path}`);
        const body = await res.text();
        const looksEmptyButOk =
          res.status() === 200 && /"(jobs|datasets)":\s*\[\s*\]/.test(body);
        expect(
          looksEmptyButOk,
          `${path} returned an empty list instead of an error while the backend was down`,
        ).toBe(false);
      }

      // The app itself must stay up: navigation, login state, static pages.
      await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
      await expect(page.locator("body")).not.toContainText(/Application error|Unhandled Runtime/i);
      await expect(page.locator("nav, aside").first()).toBeVisible({ timeout: 25_000 });
    } finally {
      await start("rantai-backend");
    }
  });

  test("data comes back once the backend does", async ({ request }) => {
    await expect
      .poll(
        async () => (await request.get(`${BASE}/api/tasks/list`)).status(),
        { timeout: 120_000, message: "the backend is running but the app still cannot reach it" },
      )
      .toBe(200);

    const jobs = (await (await request.get(`${BASE}/api/tasks/list`)).json()).jobs ?? [];
    expect(jobs.length, "job history did not come back").toBeGreaterThan(0);
  });
});
