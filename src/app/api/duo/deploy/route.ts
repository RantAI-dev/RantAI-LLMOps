import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { DuoDeployError, duoPairStatus, parseDuoDeployRequest, rollbackDuoRole, startDuoDeploy } from "@/lib/duo-deploy";
import { deployerCall, deployerConfigured } from "@/lib/duo-deployer-client";
import { listTrainedAdapters } from "@/lib/trained-adapters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const failed = (err: unknown) =>
  Response.json({ error: err instanceof Error ? err.message : "Duo deploy failed" }, { status: err instanceof DuoDeployError ? err.status : 500 });

/**
 * What System 1 and System 2 serve now, the last deployment of each, and the trained adapters that could be used.
 * With DUO_DEPLOYER_URL set, the status comes from the Duo deployer (which holds the Docker socket); otherwise from a
 * local socket, if any.
 */
export async function GET(req: NextRequest) {
  const denied = await guardApi(req);
  if (denied) return denied;
  try {
    const status = deployerConfigured() ? deployerCall("/status").then((r) => r.json as object) : duoPairStatus();
    const [s, adapters] = await Promise.all([status, listTrainedAdapters().catch(() => [])]);
    return Response.json({ ...s, adapters });
  } catch (err) {
    return failed(err);
  }
}

/**
 * `{ role, baseModel, adapterPath?, maxModelLen? }` replaces that role's model (202, it keeps going in the
 * background); `{ role, action: "rollback" }` brings the previous container back.
 */
export async function POST(req: NextRequest) {
  const denied = await guardApi(req);
  if (denied) return denied;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const b = body as { action?: unknown; role?: unknown };
    if (b?.action === "rollback") {
      if (b.role !== "s1" && b.role !== "s2") throw new DuoDeployError("`role` must be s1 or s2", 400);
      if (deployerConfigured()) await deployerCall("/rollback", { role: b.role });
      else await rollbackDuoRole(b.role);
      return Response.json({ ok: true });
    }
    // Validated here too, so a bad request never leaves the frontend.
    const r = parseDuoDeployRequest(body);
    if (deployerConfigured()) return Response.json((await deployerCall("/deploy", r)).json, { status: 202 });
    return Response.json(startDuoDeploy(r), { status: 202 });
  } catch (err) {
    return failed(err);
  }
}
