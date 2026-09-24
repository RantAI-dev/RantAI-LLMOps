import fs from "node:fs";
import path from "node:path";

import { defineConfig } from "@playwright/test";

// Load APP_PASSWORD (and friends) from .env.local when the shell didn't export
// them, so the suite runs with a plain `npx playwright test`.
const envFile = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rawValue] = m;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["'](.*)["']$/, "$1").trim();
  }
}

/** Browser pass over a DEPLOYED instance — see tests/ui.spec.ts for usage. */
export default defineConfig({
  testDir: "./tests",
  // resilience.spec.ts STOPS CONTAINERS. It is opt-in: run it by naming the
  // file, so a plain `npx playwright test` can never take the box down.
  testIgnore: process.env.RESILIENCE === "1" ? [] : ["**/resilience.spec.ts"],
  globalSetup: "./tests/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  // JSON to a file as well: the list reporter's stdout is lost when the
  // suite is driven from a background shell on Windows.
  reporter: [["list"], ["json", { outputFile: "test-results/report.json" }]],
  use: {
    headless: true,
    storageState: "test-results/.auth.json",
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
  },
});
