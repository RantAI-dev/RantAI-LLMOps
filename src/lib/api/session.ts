/**
 * Client-side session storage for the direct API transport: the JWT and the
 * active team id (Transformer Lab is multi-tenant via the `X-Team-Id` header).
 *
 * Kept dependency-free so both `client.ts` and `auth.ts` can use it without a
 * circular import. localStorage is browser-only — every accessor guards SSR.
 */
const TOKEN_KEY = "nq.tl.token";
const TEAM_KEY = "nq.tl.team";
const USER_KEY = "nq.tl.user";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getUserEmail(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(USER_KEY);
}

export function setUserEmail(email: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(USER_KEY, email);
}

export function getTeamId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TEAM_KEY);
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function setTeamId(teamId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TEAM_KEY, teamId);
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(TEAM_KEY);
  window.localStorage.removeItem(USER_KEY);
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}
