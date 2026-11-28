import fs from "node:fs";

import { expect, test, type Page } from "@playwright/test";

/**
 * Browser pass over the Semantic Duo pages of a DEPLOYED instance with a live Rantai-Aql gateway behind it:
 *   BASE_URL=http://host:3000 APP_PASSWORD=… npx playwright test tests/duo-ui.spec.ts
 * Every page must render without a page error, without an error boundary, and without a failing gateway call;
 * a screenshot of each lands in test-results/duo/. The interaction tests ask one question in Chat and in a Room.
 */
const BASE = process.env.BASE_URL ?? "http://10.17.254.27:3000";
const SHOTS = "test-results/duo";
const PAGES = ["", "rooms", "knowledge", "files", "code", "quality", "learning", "experiments", "cache", "speed", "status", "models"];

function watch(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Download the React DevTools/.test(m.text())) problems.push(`console: ${m.text().slice(0, 300)}`);
  });
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/duo/") && r.status() >= 400) problems.push(`${r.request().method()} ${u.pathname}${u.search} -> ${r.status()}`);
  });
  return problems;
}

test.beforeAll(() => fs.mkdirSync(SHOTS, { recursive: true }));

for (const p of PAGES) {
  test(`Semantic Duo page /duo/${p} renders cleanly`, async ({ page }) => {
    const problems = watch(page);
    await page.goto(`${BASE}/duo/${p}`);
    await expect(page.getByRole("link", { name: "Semantic Duo" }).first()).toBeVisible();
    await page.waitForTimeout(5000);
    await expect(page.getByText(/Something went wrong|Application error/i)).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/${p || "chat"}.png`, fullPage: true });
    expect(problems, problems.join("\n")).toEqual([]);
  });
}

test("Chat: a question gets a streamed answer with its assurance", async ({ page }) => {
  const problems = watch(page);
  await page.goto(`${BASE}/duo`);
  const box = page.getByPlaceholder(/Ask a question/);
  await box.fill("What is 21 times 3? Answer briefly.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/\b63\b/).first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/^(Checked|Agreed|Not checked|Abstained)$/).first()).toBeVisible({ timeout: 120_000 });
  await page.screenshot({ path: `${SHOTS}/chat-answer.png`, fullPage: true });
  expect(problems, problems.join("\n")).toEqual([]);
  // Leave nothing behind on the deployment.
  const convs = (await (await page.request.get(`${BASE}/api/duo/gw/v1/conversations`)).json()) as { conversation_id: string; title?: string }[];
  for (const c of convs.filter((x) => x.title === "What is 21 times 3? Answer briefly.")) {
    await page.request.delete(`${BASE}/api/duo/gw/v1/conversations/${c.conversation_id}`);
  }
});

test("Rooms: create a room, ask in it, delete it", async ({ page }) => {
  const problems = watch(page);
  // Letters only, so the answer "11" below cannot match the room's own name.
  const name = `Playwright room ${Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 6)}`;
  await page.goto(`${BASE}/duo/rooms`);
  await page.getByLabel("New room name").fill(name);
  await page.getByLabel("New room name").press("Enter");
  const box = page.getByPlaceholder(`Message “${name}”…`);
  await expect(box).toBeVisible({ timeout: 30_000 });
  await box.fill("What is 5 plus 6?");
  await page.getByRole("button", { name: "Send to the room" }).click();
  await expect(page.getByText(/\b11\b/).first()).toBeVisible({ timeout: 180_000 });
  await page.screenshot({ path: `${SHOTS}/room-answer.png`, fullPage: true });
  expect(problems, problems.join("\n")).toEqual([]);
  const rooms = (await (await page.request.get(`${BASE}/api/duo/gw/v1/rooms`)).json()) as { room_id: string; name: string }[];
  const mine = rooms.find((r) => r.name === name);
  expect(mine).toBeTruthy();
  expect((await page.request.delete(`${BASE}/api/duo/gw/v1/rooms/${mine!.room_id}`)).ok()).toBe(true);
});
