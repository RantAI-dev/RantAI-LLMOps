import fs from "node:fs";
import path from "node:path";

import { chromium } from "@playwright/test";

/**
 * Sign in ONCE for the whole suite and save the session.
 *
 * `/api/auth/login` allows 10 attempts per 5 minutes per IP. A suite that logs
 * in per test trips that limit and every later test then times out on the login
 * page — which looks exactly like a broken product. Waiting out an active limit
 * here, once, keeps the failures honest.
 */
export const STORAGE_STATE = path.join(process.cwd(), "test-results", ".auth.json");

/**
 * Log in over HTTP and return the session cookie.
 *
 * This is the ONLY login the suite performs. An earlier version probed with one
 * request and then logged in again through the browser, which burned two of the
 * ten attempts per window and could re-trip the limit it had just waited out.
 */
async function loginForCookie(base: string, password: string): Promise<string> {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
      redirect: "manual",
    });
    if (res.status === 200) {
      const setCookie = res.headers.get("set-cookie") ?? "";
      const cookie = setCookie.split(";")[0];
      if (!cookie) throw new Error("Login succeeded but returned no session cookie.");
      return cookie;
    }
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

export default async function globalSetup() {
  const base = process.env.BASE_URL ?? "http://10.17.254.27:3000";
  const password = process.env.APP_PASSWORD ?? "";
  if (!password) throw new Error("APP_PASSWORD is required (pass it on the command line).");

  const cookie = await loginForCookie(base, password);
  const [name, ...rest] = cookie.split("=");
  const url = new URL(base);

  // Plant the cookie directly rather than driving the login form again — that
  // second login is what kept re-tripping the rate limit.
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies([
    {
      name,
      value: rest.join("="),
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "Lax",
    },
  ]);

  const page = await context.newPage();
  await page.goto(`${base}/dashboard`, { waitUntil: "domcontentloaded" });
  if (new URL(page.url()).pathname.startsWith("/login")) {
    throw new Error("Session cookie was rejected — the app did not accept it.");
  }

  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });
  await context.storageState({ path: STORAGE_STATE });
  await browser.close();
}
