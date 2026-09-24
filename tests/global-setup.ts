import fs from "node:fs";
import path from "node:path";

import { chromium, type FullConfig } from "@playwright/test";

/**
 * Sign in ONCE for the whole suite and save the session.
 *
 * `/api/auth/login` allows 10 attempts per 5 minutes per IP. A suite that logs
 * in per test trips that limit and every later test then times out on the login
 * page — which looks exactly like a broken product. Waiting out an active limit
 * here, once, keeps the failures honest.
 */
export const STORAGE_STATE = path.join(process.cwd(), "test-results", ".auth.json");

async function waitForLoginWindow(base: string, password: string) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.status === 200) return;
    if (res.status !== 429) {
      throw new Error(
        `Login rejected with ${res.status}. Check APP_PASSWORD matches the deployment ` +
          `(the dev .env.local value is deliberately different from the server's).`
      );
    }
    const retryAfter = Number(res.headers.get("retry-after") ?? 30);
    // +2s of slack: the window is per-IP and the probe above consumed an attempt.
    const waitMs = (Number.isFinite(retryAfter) ? retryAfter : 30) * 1000 + 2000;
    console.log(`[auth] rate-limited, waiting ${Math.round(waitMs / 1000)}s…`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  throw new Error("Login stayed rate-limited after 12 attempts.");
}

export default async function globalSetup(_config: FullConfig) {
  const base = process.env.BASE_URL ?? "http://10.17.254.27:3000";
  const password = process.env.APP_PASSWORD ?? "";
  if (!password) throw new Error("APP_PASSWORD is required (pass it on the command line).");

  await waitForLoginWindow(base, password);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /sign in|masuk|log ?in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30_000 });

  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
  await page.context().storageState({ path: STORAGE_STATE });
  await browser.close();
}
