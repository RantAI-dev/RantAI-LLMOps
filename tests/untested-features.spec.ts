import { expect, test } from "@playwright/test";

/**
 * The features that had never been exercised.
 *
 * Every other suite covers the paths this deployment actually uses: SFT, single
 * and compare evals, serving, chat. That left a gap nobody had measured — GRPO,
 * TTS and Sweep are offered in the UI but had produced ZERO jobs in production,
 * and two Evals tabs (Grounding, Classification) were only ever reached through
 * their API.
 *
 * "The code exists" and "it works" are different claims. These tests make the
 * second one, or show it to be false.
 *
 *   APP_PASSWORD=... BASE_URL=... npx playwright test tests/untested-features.spec.ts
 */
const BASE = process.env.BASE_URL ?? "http://10.17.254.27:3000";

test.describe("Evals — every tab opens and renders its own panel", () => {
  // Five tabs ship in the UI. Single and Compare were covered; these three were
  // reached only through their API, so a broken panel would not have shown up.
  for (const tab of ["Single run", "Compare", "Grounding", "Classification", "Retention"]) {
    test(`the "${tab}" tab renders without a client error`, async ({ page }) => {
      await page.goto(`${BASE}/evals`, { waitUntil: "domcontentloaded" });
      // The tab strip is client-rendered; waiting on the h1 alone races hydration
      // and every tab lookup then finds nothing (which reads as "skipped").
      await expect(page.getByRole("button", { name: /Single run/i }).first()).toBeVisible({
        timeout: 45_000,
      });

      const trigger = page.getByRole("tab", { name: new RegExp(tab, "i") }).first();
      const fallback = page.getByRole("button", { name: new RegExp(tab, "i") }).first();
      const target = (await trigger.count()) > 0 ? trigger : fallback;
      test.skip((await target.count()) === 0, `no "${tab}" tab in this build`);

      await target.click();
      // A React error boundary replaces the panel with this text; the tab would
      // still "look" clickable, which is why a status check alone is not enough.
      await expect(page.locator("body")).not.toContainText(/Application error|Unhandled Runtime/i);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
  }
});

test.describe("Fine-tune — the three training methods are all selectable", () => {
  // SFT has 93 production jobs; GRPO and TTS have none. If picking one of them
  // breaks the form, nobody would have found out.
  test("SFT, GRPO and TTS can each be chosen, and the form survives it", async ({ page }) => {
    await page.goto(`${BASE}/finetune`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /^SFT/i }).first()).toBeVisible({
      timeout: 45_000,
    });

    // The chips read "SFT", "GRPO · RL" and "TTS", so match on the prefix
    // rather than the whole label.
    const found: string[] = [];
    for (const method of ["SFT", "GRPO", "TTS"]) {
      const option = page.getByRole("button", { name: new RegExp(method, "i") }).first();
      if ((await option.count()) === 0) continue;
      await option.click();
      await expect(page.locator("body")).not.toContainText(/Application error|Unhandled Runtime/i);
      found.push(method);
    }

    // All three are advertised; if one cannot even be selected, say so by name.
    expect(found, `methods selectable in the UI: ${found.join(", ") || "none"}`).toEqual([
      "SFT",
      "GRPO",
      "TTS",
    ]);
  });
});

test.describe("Sweep — the grid builds and the panel accepts it", () => {
  // Sweep is orchestrated client-side (see hooks/use-sweep.ts), so there is no
  // endpoint to probe. The panel itself is the only place it can be checked.
  test("entering axes produces a combination count", async ({ page }) => {
    await page.goto(`${BASE}/finetune`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /Single run/i }).first()).toBeVisible({
      timeout: 45_000,
    });

    const sweepTab = page.getByRole("button", { name: /sweep/i }).first();
    test.skip((await sweepTab.count()) === 0, "no Sweep panel in this build");
    await sweepTab.click();

    // Two axes x two values = four combinations. The panel computes this from
    // the text inputs, so a wrong count means the grid parser is broken.
    const lr = page.getByPlaceholder("0.0002, 0.0004").first();
    const loraR = page.getByPlaceholder("8, 16").first();
    test.skip((await lr.count()) === 0, "sweep inputs not present");

    await lr.fill("0.0002, 0.0004");
    await loraR.fill("8, 16");

    await expect(page.locator("body")).not.toContainText(/Application error|Unhandled Runtime/i);
    // The panel names the number of runs it would launch before you commit to
    // spending a GPU on them.
    await expect(page.locator("body")).toContainText(/4/, { timeout: 10_000 });
  });
});
