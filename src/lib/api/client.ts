import { API_BASE_URL } from "@/lib/api/config";
import { getTeamId, getToken } from "@/lib/api/session";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Thin fetch wrapper for talking to Transformer Lab directly from the browser.
 * Adds the bearer token + `X-Team-Id`, sends/parses JSON, and throws ApiError on
 * non-2xx. This is the single place that knows how to reach the backend.
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const teamId = getTeamId();
  if (teamId) headers.set("X-Team-Id", teamId);

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new ApiError(res.status, detail || `${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  return (contentType.includes("application/json") ? await res.json() : await res.text()) as T;
}
