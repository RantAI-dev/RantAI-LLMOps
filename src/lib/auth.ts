/**
 * Lightweight shared-password gate for the whole app.
 *
 * Opt-in: set `APP_PASSWORD` in the environment to enable. When unset the gate
 * is OFF (local single-user dev stays frictionless). When set, every page/route
 * (except the login page + auth API) requires a valid session cookie, obtained
 * by entering the password once.
 *
 * The cookie holds a SHA-256 token derived from the password *and* a
 * server-side `AUTH_SECRET` — never the password itself. Folding in the secret
 * means a leaked cookie can't be reduced to an offline password guess, and
 * rotating `AUTH_SECRET` invalidates every existing session. `sessionToken()`
 * uses Web Crypto so it works in both the Edge and the Node runtime.
 */
import { DEMO_MODE, DEMO_PASSWORD } from "@/lib/demo";

export const APP_PASSWORD = process.env.APP_PASSWORD ?? "";
/**
 * The password the gate actually checks. In demo mode it's a fixed, publicly-
 * hinted password (default "rantai-admin") so any visitor can enter the showcase;
 * otherwise it's APP_PASSWORD.
 */
export const EFFECTIVE_PASSWORD = DEMO_MODE ? DEMO_PASSWORD : APP_PASSWORD;
export const AUTH_ENABLED = EFFECTIVE_PASSWORD.length > 0;
export const AUTH_COOKIE = "rantai_auth";
/** 30 days. */
export const AUTH_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Per-deployment secret mixed into the session token. Optional but recommended:
 * without it the token is `SHA-256(password)`, which is offline-guessable if the
 * cookie ever leaks. Defaults to a constant so local dev keeps working unset.
 */
const DEFAULT_AUTH_SECRET = "rantai-default-secret";
const RAW_AUTH_SECRET = process.env.AUTH_SECRET ?? "";
const AUTH_SECRET = RAW_AUTH_SECRET || DEFAULT_AUTH_SECRET;

/** Passwords too guessable to protect a production deployment. */
const WEAK_PASSWORDS = new Set(["rantai-admin", "admin", "admin123", "password", "changeme", "rantai"]);

/**
 * In production the gate MUST be configured securely. When any of these hold the
 * proxy fails CLOSED (503) instead of silently serving an unauthenticated app.
 * Always `null` in development, so local single-user dev stays frictionless.
 */
export const AUTH_MISCONFIG: string | null = (() => {
  if (DEMO_MODE) return null; // demo intentionally uses a known, publicly-hinted password
  if (process.env.NODE_ENV !== "production") return null;
  if (!AUTH_ENABLED) return "APP_PASSWORD is not set";
  if (WEAK_PASSWORDS.has(APP_PASSWORD.toLowerCase())) return "APP_PASSWORD is a known weak/default value";
  if (!RAW_AUTH_SECRET || RAW_AUTH_SECRET === DEFAULT_AUTH_SECRET)
    return "AUTH_SECRET is unset or left at the insecure default";
  return null;
})();

if (AUTH_MISCONFIG) {
  console.error(`[auth] Refusing to serve requests: ${AUTH_MISCONFIG}. Set a strong APP_PASSWORD and AUTH_SECRET.`);
}

/** Session token = SHA-256("rantai::" + secret + "::" + password), hex. */
export async function sessionToken(): Promise<string> {
  const data = new TextEncoder().encode(`rantai::${AUTH_SECRET}::${EFFECTIVE_PASSWORD}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Constant-time string comparison. Avoids the early-exit timing leak of `===`
 * on secrets. Pure JS so it runs in any runtime (no `node:crypto` dependency).
 * A length mismatch returns early, which leaks only the length — harmless here
 * since the token is always a fixed-length (64-char) SHA-256 hex digest, a value
 * that isn't secret. When lengths match (the case that matters) the scan is
 * branch-free over the full string.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when the cookie value is a valid, current session token. */
export async function verifySession(cookie: string | undefined): Promise<boolean> {
  if (!cookie) return false;
  return constantTimeEqual(cookie, await sessionToken());
}
