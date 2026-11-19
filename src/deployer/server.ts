/**
 * Duo deployer (docs/RENCANA-DUO.md, D3): the only process that holds the Docker socket for Duo deployments.
 *
 * The Docker socket is root-equivalent on the host, so it is not mounted into the LLMOps frontend (which is reachable
 * on the network with a shared password). This small server runs from the same image in its own container, with the
 * socket and no published port, and accepts exactly three things from the frontend over the internal network:
 *
 *   GET  /status    what System 1 and System 2 serve now (duoPairStatus)
 *   POST /deploy    { role, baseModel, adapterPath?, maxModelLen? } validated by parseDuoDeployRequest
 *   POST /rollback  { role }
 *   GET  /healthz   liveness, no token
 *
 * Every other path is 404, every call but /healthz needs `Authorization: Bearer $DUO_DEPLOYER_TOKEN`. Whoever has the
 * token can only swap the model or adapter behind aql-s1 / aql-s2 (a Hugging Face id and an adapter under the
 * Transformer Lab data), never create an arbitrary container.
 *
 * Entry point: src/deployer/main.ts, bundled into the image as /app/deployer/duo-deployer.cjs (esbuild) and started
 * with `node deployer/duo-deployer.cjs`.
 */
import { timingSafeEqual } from "node:crypto";
import http from "node:http";

import { DuoDeployError, duoPairStatus, parseDuoDeployRequest, rollbackDuoRole, startDuoDeploy } from "@/lib/duo-deploy";

const MAX_BODY = 16 * 1024;

export function tokenMatches(header: string | undefined, token: string): boolean {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new DuoDeployError("Body too large", 413));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "null"));
      } catch {
        reject(new DuoDeployError("Invalid JSON body", 400));
      }
    });
    req.on("error", reject);
  });
}

export function createDeployerServer(token: string): http.Server {
  return http.createServer(async (req, res) => {
    const path = (req.url ?? "").split("?")[0];
    if (req.method === "GET" && path === "/healthz") return send(res, 200, { ok: true });
    if (!tokenMatches(req.headers.authorization, token)) return send(res, 401, { error: "Unauthorized" });
    try {
      if (req.method === "GET" && path === "/status") return send(res, 200, await duoPairStatus());
      if (req.method === "POST" && path === "/deploy") return send(res, 202, startDuoDeploy(parseDuoDeployRequest(await readJson(req))));
      if (req.method === "POST" && path === "/rollback") {
        const role = (((await readJson(req)) ?? {}) as { role?: unknown }).role;
        if (role !== "s1" && role !== "s2") throw new DuoDeployError("`role` must be s1 or s2", 400);
        await rollbackDuoRole(role);
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: "Not found" });
    } catch (err) {
      const status = err instanceof DuoDeployError ? err.status : 500;
      send(res, status, { error: err instanceof Error ? err.message : "Duo deploy failed" });
    }
  });
}
