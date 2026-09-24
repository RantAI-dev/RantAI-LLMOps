import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * Behaviour under concurrency.
 *
 * Every other suite sends one request at a time, so all of them describe a
 * system with no contention. These fire batches at it and check three things
 * a serial test cannot see: that nothing times out or 500s, that reads stay
 * consistent while a write lands, and that the login rate limiter holds when
 * hit from several directions at once.
 *
 * Deliberately modest — a dozen or two in flight, not a stress test. The point
 * is to catch a lock or an unbounded fan-out, not to find the breaking point
 * of a box nobody is using yet.
 *
 *   RUN_LOAD=1 APP_PASSWORD=... BASE_URL=... npx playwright test tests/load.spec.ts
 */
const BASE = process.env.BASE_URL ?? "http://10.17.254.27:3000";

/** Read endpoints that hit the backend, so contention is real. */
const READS = [
  "/api/tasks/list",
  "/api/datasets/list",
  "/api/models/catalog",
  "/api/serve/info",
  "/api/traces",
  "/api/finetune/jobs",
];

type Outcome = { path: string; status: number; ms: number };

async function timed(request: APIRequestContext, path: string): Promise<Outcome> {
  const t0 = Date.now();
  const res = await request.get(BASE + path);
  return { path, status: res.status(), ms: Date.now() - t0 };
}

test.describe("Concurrent reads", () => {
  test("24 simultaneous reads all succeed", async ({ request }) => {
    // Four rounds of the six endpoints, all in flight together.
    const batch = [...READS, ...READS, ...READS, ...READS];
    const results = await Promise.all(batch.map((p) => timed(request, p)));

    const bad = results.filter((r) => r.status !== 200);
    expect(bad, `non-200 under load:\n${JSON.stringify(bad, null, 1)}`).toHaveLength(0);

    // A serialising lock shows up as a tail far worse than the median.
    const times = results.map((r) => r.ms).sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    const slowest = times[times.length - 1];
    console.log(`[load] 24 reads — median ${median}ms, slowest ${slowest}ms`);
    expect(slowest, `slowest read took ${slowest}ms`).toBeLessThan(30_000);
  });

  test("repeated polling does not degrade", async ({ request }) => {
    // The Compute page polls every ~2.5s; make sure a burst of that does not
    // leak handles or slow down as it goes.
    const first = await Promise.all(
      Array.from({ length: 8 }, () => timed(request, "/api/compute/gpu-metrics")),
    );
    const second = await Promise.all(
      Array.from({ length: 8 }, () => timed(request, "/api/compute/gpu-metrics")),
    );

    for (const r of [...first, ...second]) expect(r.status).toBe(200);

    const avg = (xs: Outcome[]) => xs.reduce((s, r) => s + r.ms, 0) / xs.length;
    const a = avg(first);
    const b = avg(second);
    console.log(`[load] gpu-metrics — first burst ${a.toFixed(0)}ms, second ${b.toFixed(0)}ms`);
    // Allow noise, but a second round several times slower means something is
    // accumulating between calls.
    expect(b).toBeLessThan(Math.max(a * 5, 10_000));
  });
});

test.describe("Reads stay correct while a write lands", () => {
  test("a dataset created mid-flight appears exactly once", async ({ request }) => {
    const name = `load-${Date.now().toString(36)}-ds`;

    // Fire reads and the write together, so the list is being read as it changes.
    const [created] = await Promise.all([
      request.post(`${BASE}/api/datasets/create`, {
        data: {
          name,
          rows: [{ prompt: "Ibu kota Indonesia?", completion: "Jakarta." }],
        },
      }),
      ...Array.from({ length: 6 }, () => request.get(`${BASE}/api/datasets/list`)),
    ]);
    expect(created.status(), await created.text()).toBeLessThan(300);

    // After the dust settles the dataset must be listed once — not zero times
    // (lost write) and not twice (duplicate from a racing create).
    const body = await (await request.get(`${BASE}/api/datasets/list`)).json();
    const matches = (body.datasets ?? []).filter((d: { id: string }) => d.id === name);
    expect(matches, `expected exactly one "${name}"`).toHaveLength(1);

    await request.post(`${BASE}/api/datasets/delete`, { data: { datasetId: name } });
  });
});

test.describe("The login limiter holds under parallel attempts", () => {
  test("a burst of wrong passwords is refused, never granted", async ({ playwright }) => {
    const anon = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });

    const attempts = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        anon
          .post(`${BASE}/api/auth/login`, { data: { password: `wrong-${i}` } })
          .then((r) => r.status()),
      ),
    );
    await anon.dispose();

    // Every one must be rejected: 401 (wrong) or 429 (limited). A 200 here
    // would mean the limiter let a guess through under concurrency.
    const granted = attempts.filter((s) => s === 200);
    expect(granted, `a wrong password was accepted: ${attempts.join(",")}`).toHaveLength(0);
    console.log(`[load] 12 parallel bad logins — statuses ${[...new Set(attempts)].join(", ")}`);
    // And the limiter has to engage rather than serving all twelve.
    expect(attempts).toContain(429);
  });
});
