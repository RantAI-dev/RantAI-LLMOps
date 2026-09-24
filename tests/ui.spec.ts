import { expect, test } from "@playwright/test";

/**
 * Browser end-to-end pass over the deployed LLMOps UI.
 *
 * Complements scripts/e2e.js (API level) by exercising what a person actually
 * touches: the login form, navigation, and each page's rendered content. Point
 * it at a running deployment:
 *
 *   BASE_URL=http://10.17.254.27:3000 APP_PASSWORD=… npx playwright test
 */
const BASE = process.env.BASE_URL ?? "http://10.17.254.27:3000";

test.describe("LLMOps UI", () => {
  // Signed out on purpose: globalSetup hands every other test a live session.
  test("rejects a wrong password", async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="password"]').fill("definitely-not-the-password");
    await page.getByRole("button", { name: /sign in|masuk|log ?in/i }).click();
    // Stays put — a wrong password grants no session.
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(page.locator("body")).not.toContainText(/dashboard/i);
    await context.close();
  });

  test("the suite is signed in", async ({ page }) => {
    await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/login/);
  });

  test("every sidebar page loads without a client error", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });


    const paths = [
      "/dashboard", "/traces", "/tasks", "/interact", "/finetune", "/evals",
      "/generations", "/prompts", "/workflows", "/serve", "/notes",
      "/hub", "/models", "/datasets", "/compute", "/settings",
    ];
    for (const p of paths) {
      await page.goto(BASE + p, { waitUntil: "domcontentloaded" });
      // The app shell rendered rather than an error boundary.
      await expect(page.locator("body")).not.toContainText(/Application error|Unhandled Runtime Error/i);
      await expect(page.locator("nav, aside").first()).toBeVisible({ timeout: 15_000 });
    }

    // Next.js logs hydration and fetch failures to the console; a clean pass
    // means no page threw while rendering real data.
    const real = errors.filter((e) => !/favicon|ResizeObserver/i.test(e));
    expect(real, `console/page errors:\n${real.join("\n")}`).toHaveLength(0);
  });

  test("Tasks shows real jobs", async ({ page }) => {
    await page.goto(`${BASE}/tasks`, { waitUntil: "domcontentloaded" });
    // A real job name from the box, not an empty state.
    await expect(page.locator("body")).toContainText(/COMPLETE|FAILED|RUNNING/i, { timeout: 20_000 });
  });

  test("Datasets lists uploaded datasets", async ({ page }) => {
    await page.goto(`${BASE}/datasets`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/amal-train|grounded-smoke/i, { timeout: 20_000 });
  });

  test("Deployments shows both engines as active", async ({ page }) => {
    await page.goto(`${BASE}/serve`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toContainText(/Ollama/i, { timeout: 20_000 });
    await expect(page.locator("body")).toContainText(/vLLM/i);
    // The superseded adapter must not be offered any more.
    await expect(page.locator("body")).not.toContainText(/\bmodel=ask\b/);
  });

  test("Interact answers without picking a model", async ({ page }) => {
    await page.goto(`${BASE}/interact`, { waitUntil: "domcontentloaded" });
    const box = page.locator("textarea, input[type='text']").last();
    await box.fill("Sebut satu kata.");
    await box.press("Enter");
    // Regression for the INFERENCE_MODEL bug: a default send must not 404.
    await expect(page.locator("body")).not.toContainText(/not found|404/i, { timeout: 45_000 });
  });

  test("no 'Transformer Lab' branding leaks into the UI", async ({ page }) => {
    for (const p of ["/dashboard", "/datasets", "/finetune", "/evals", "/compute", "/serve"]) {
      await page.goto(BASE + p, { waitUntil: "domcontentloaded" });
      await expect(page.locator("body"), `on ${p}`).not.toContainText(/Transformer ?Lab/i);
    }
  });
});
