/**
 * Lightweight shared-password gate for the whole app.
 *
 * Opt-in: set `APP_PASSWORD` in the environment to enable. When unset the gate
 * is OFF (local single-user dev stays frictionless). When set, every page/route
 * (except the login page + auth API) requires a valid session cookie, obtained
 * by entering the password once.
 *
 * The cookie holds a SHA-256 token derived from the password — never the
 * password itself. `sessionToken()` uses Web Crypto so it works in both the Edge
 * middleware and Node route handlers.
 */
export const APP_PASSWORD = process.env.APP_PASSWORD ?? "";
export const AUTH_ENABLED = APP_PASSWORD.length > 0;
export const AUTH_COOKIE = "nqr_auth";
/** 30 days. */
export const AUTH_MAX_AGE = 60 * 60 * 24 * 30;

/** Deterministic session token = SHA-256("nqr::" + password), hex. */
export async function sessionToken(): Promise<string> {
  const data = new TextEncoder().encode(`nqr::${APP_PASSWORD}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
