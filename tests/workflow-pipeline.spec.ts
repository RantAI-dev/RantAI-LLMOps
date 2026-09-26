import { expect, test } from "@playwright/test";

/**
 * The one-click pipeline, run for real.
 *
 * Workflows chains fine-tune → eval → export over three BFF routes that are all
 * proven individually. What was never exercised is the CHAINING — and it cannot
 * be probed through an endpoint, because the orchestration runs in the BROWSER
 * (modules/workflows/hooks/use-pipeline.ts). The page is the only place it runs.
 *
 * That has a consequence this test is built around: the pipeline advances only
 * while the tab is open. A first version of this test asserted against page text
 * and "passed" in 6 seconds while the train job was still LAUNCHING — then the
 * browser closed and the eval stage never ran at all. So the checks here are
 * against the JOB LIST, which is ground truth, not against what the page says.
 *
 * This spends real GPU time. Opt in:
 *   RUN_PIPELINE=1 APP_PASSWORD=... BASE_URL=... npx playwright test tests/workflow-pipeline.spec.ts
 */
const BASE = process.env.BASE_URL ?? "http://10.17.254.27:3000";

type Job = { template?: string; status?: string; name?: string };

test.describe("Workflows — one-click pipeline", () => {
  test.skip(process.env.RUN_PIPELINE !== "1", "set RUN_PIPELINE=1: this trains a real model");
  test.setTimeout(40 * 60_000);

  test("a run trains, then evals — the chain carries on by itself", async ({ page, request }) => {
    const tag = `pipe-${Date.now().toString(36)}`;

    await page.goto(`${BASE}/workflows`, { waitUntil: "domcontentloaded" });
    const run = page.getByRole("button", { name: /Run pipeline/i }).first();
    await expect(run).toBeVisible({ timeout: 45_000 });

    // Model, dataset and adapter name are all required (canRun in
    // workflows-page.tsx); the form starts empty. Each picker shows its
    // shortlist only once focused, and is scoped to its own <label> so a stray
    // button elsewhere on the page cannot be clicked instead.
    const pickFrom = async (label: string, placeholder: string) => {
      const field = page.locator("label").filter({ hasText: label }).first();
      const box = field.getByPlaceholder(placeholder);
      await expect(box).toBeVisible({ timeout: 30_000 });
      await box.click();
      const option = field.locator("button").first();
      await expect(option).toBeVisible({ timeout: 20_000 });
      await option.click();
      await expect(field, `${label} was never selected`).toContainText("✓", {
        timeout: 10_000,
      });
    };
    await pickFrom("Base model", "Type to search models, or pick from the list…");
    await pickFrom("Dataset", "Type to search datasets, or pick from the list…");
    await page.getByPlaceholder("e.g. rugby-pipeline").first().fill(tag);

    await expect(run, "Run pipeline never became enabled after filling the form").toBeEnabled({
      timeout: 30_000,
    });
    await run.click();

    const jobs = async (): Promise<Job[]> => {
      const res = await request.get(`${BASE}/api/tasks/list`);
      if (!res.ok()) return [];
      return ((await res.json())?.jobs ?? []) as Job[];
    };
    const trainStatus = async () =>
      (await jobs()).find((j) => j.template === tag)?.status ?? "absent";

    // Stage 1 — a train job must exist under the name we typed. "Running…" on
    // the button proves only that a click handler fired.
    await expect
      .poll(trainStatus, {
        timeout: 3 * 60_000,
        intervals: [5_000],
        message: "no train job appeared",
      })
      .not.toBe("absent");

    await expect
      .poll(trainStatus, {
        timeout: 25 * 60_000,
        intervals: [15_000],
        message: "the train stage never finished",
      })
      .toBe("COMPLETE");

    // Stage 2 — the chain must carry on by itself. This is the part a page-text
    // assertion cannot see, and the part that silently did not happen when the
    // browser was allowed to close early.
    const evalCount = async () => {
      const res = await request.get(`${BASE}/api/evals/jobs`);
      if (!res.ok()) return 0;
      const list = ((await res.json())?.jobs ?? []) as Job[];
      return list.filter((j) => (j.name ?? "").includes(tag)).length;
    };
    await expect
      .poll(evalCount, {
        timeout: 10 * 60_000,
        intervals: [15_000],
        message: "training finished but the pipeline never started the eval stage",
      })
      .toBeGreaterThan(0);

    // And the page must still be coherent after all that.
    await expect(page.locator("body")).not.toContainText(/Application error|Unhandled Runtime/i);
  });
});
