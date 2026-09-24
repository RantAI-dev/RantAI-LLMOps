import { defineConfig } from "@playwright/test";

/** Browser pass over a DEPLOYED instance — see tests/ui.spec.ts for usage. */
export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    headless: true,
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
  },
});
