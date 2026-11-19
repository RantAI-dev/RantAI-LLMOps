/**
 * The frontend side of the Duo deployer (src/deployer/server.ts). When DUO_DEPLOYER_URL and DUO_DEPLOYER_TOKEN are
 * set, /api/duo/deploy forwards to the deployer instead of using a local Docker socket. Server-only.
 */
import { DuoDeployError } from "@/lib/duo-deploy";

export function deployerConfigured(): boolean {
  return Boolean(process.env.DUO_DEPLOYER_URL && process.env.DUO_DEPLOYER_TOKEN);
}

/** One call to the deployer; errors come back as DuoDeployError with the deployer's status and message. */
export async function deployerCall(path: "/status" | "/deploy" | "/rollback", body?: unknown): Promise<{ status: number; json: unknown }> {
  const base = (process.env.DUO_DEPLOYER_URL ?? "").replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${process.env.DUO_DEPLOYER_TOKEN}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
  } catch {
    throw new DuoDeployError("The Duo deployer is not reachable (DUO_DEPLOYER_URL)", 502);
  }
  const json = (await res.json().catch(() => null)) as { error?: string } | null;
  if (res.status === 401) throw new DuoDeployError("The Duo deployer refused the token (DUO_DEPLOYER_TOKEN)", 502);
  if (!res.ok) throw new DuoDeployError(json?.error ?? `Duo deployer answered ${res.status}`, res.status);
  return { status: res.status, json };
}
