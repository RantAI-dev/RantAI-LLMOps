import { apiFetch } from "@/lib/api/client";
import { API_BASE_URL, USE_REAL_API } from "@/lib/api/config";
import { clearSession, setTeamId, setToken } from "@/lib/api/session";

/**
 * Transformer Lab uses fastapi-users. Login is `POST /auth/jwt/login` with a
 * form-urlencoded body (`username`, `password`) and returns `{ access_token }`.
 */
export async function login(email: string, password: string): Promise<void> {
  if (!USE_REAL_API) {
    // Mock mode: pretend the default admin is signed in.
    setToken("mock-token");
    return;
  }

  const body = new URLSearchParams({ username: email, password });
  const res = await fetch(`${API_BASE_URL}/auth/jwt/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Login failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Login response missing access_token");
  setToken(data.access_token);
  await resolveActiveTeam();
}

/** Best-effort: pick the user's first team for the `X-Team-Id` header. */
async function resolveActiveTeam(): Promise<void> {
  try {
    const teams = await apiFetch<Array<{ id?: string; team_id?: string }>>("/users/me/teams");
    const id = teams?.[0]?.id ?? teams?.[0]?.team_id;
    if (id) setTeamId(id);
  } catch {
    // Non-fatal — some endpoints work without an explicit team header.
  }
}

export function logout(): void {
  clearSession();
}

export type CurrentUser = { email: string; name: string };

/** Fetch the signed-in user from TL (`GET /users/me`). Real-API path. */
export async function fetchCurrentUser(): Promise<CurrentUser> {
  const me = await apiFetch<{ email?: string; name?: string; full_name?: string }>("/users/me");
  const email = me.email ?? "";
  return { email, name: me.name ?? me.full_name ?? nameFromEmail(email) };
}

export function nameFromEmail(email: string): string {
  return email.split("@")[0] || "User";
}
