// @vitest-environment node
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const lib = vi.hoisted(() => ({
  duoPairStatus: vi.fn(),
  startDuoDeploy: vi.fn(),
  rollbackDuoRole: vi.fn(),
}));
vi.mock("@/lib/duo-deploy", async (orig) => ({ ...(await orig<typeof import("@/lib/duo-deploy")>()), ...lib }));

import { createDeployerServer, tokenMatches } from "@/deployer/server";
import { DuoDeployError } from "@/lib/duo-deploy";

const TOKEN = "t".repeat(32);
const server = createDeployerServer(TOKEN);
let base = "";
const call = (path: string, init: RequestInit & { auth?: boolean } = {}) =>
  fetch(base + path, { ...init, headers: init.auth === false ? {} : { Authorization: `Bearer ${TOKEN}` } }).then(async (r) => ({
    status: r.status,
    json: await r.json(),
  }));

beforeAll(async () => {
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));
beforeEach(() => {
  vi.clearAllMocks();
});

describe("tokenMatches", () => {
  it("needs the exact bearer token", () => {
    expect(tokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(tokenMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(tokenMatches(TOKEN, TOKEN)).toBe(false);
    expect(tokenMatches(undefined, TOKEN)).toBe(false);
    expect(tokenMatches("Bearer ", "")).toBe(false);
  });
});

describe("duo-deployer", () => {
  it("answers /healthz without a token and nothing else", async () => {
    expect(await call("/healthz", { auth: false })).toEqual({ status: 200, json: { ok: true } });
    expect((await call("/status", { auth: false })).status).toBe(401);
    expect(lib.duoPairStatus).not.toHaveBeenCalled();
  });

  it("serves the pair status", async () => {
    lib.duoPairStatus.mockResolvedValue({ docker: true, roles: {} });
    expect(await call("/status")).toEqual({ status: 200, json: { docker: true, roles: {} } });
  });

  it("validates a deployment before starting it", async () => {
    const bad = await call("/deploy", { method: "POST", body: JSON.stringify({ role: "s1", baseModel: "not a model" }) });
    expect(bad.status).toBe(400);
    expect(lib.startDuoDeploy).not.toHaveBeenCalled();

    lib.startDuoDeploy.mockReturnValue({ role: "s1", phase: "replacing" });
    const good = await call("/deploy", { method: "POST", body: JSON.stringify({ role: "s1", baseModel: "Qwen/Qwen3-1.7B" }) });
    expect(good).toEqual({ status: 202, json: { role: "s1", phase: "replacing" } });
    expect(lib.startDuoDeploy).toHaveBeenCalledWith({ role: "s1", baseModel: "Qwen/Qwen3-1.7B", adapterPath: null, maxModelLen: 8192 });
  });

  it("passes the library's status codes through", async () => {
    lib.startDuoDeploy.mockImplementation(() => {
      throw new DuoDeployError("System 1 is already being replaced", 409);
    });
    expect(await call("/deploy", { method: "POST", body: JSON.stringify({ role: "s1", baseModel: "Qwen/Qwen3-1.7B" }) })).toEqual({
      status: 409,
      json: { error: "System 1 is already being replaced" },
    });
  });

  it("rolls back one role only", async () => {
    expect((await call("/rollback", { method: "POST", body: JSON.stringify({ role: "s3" }) })).status).toBe(400);
    expect(await call("/rollback", { method: "POST", body: JSON.stringify({ role: "s2" }) })).toEqual({ status: 200, json: { ok: true } });
    expect(lib.rollbackDuoRole).toHaveBeenCalledWith("s2");
  });

  it("rejects bad JSON, large bodies and unknown paths", async () => {
    expect((await call("/deploy", { method: "POST", body: "{" })).status).toBe(400);
    const big = await fetch(base + "/deploy", { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` }, body: "x".repeat(20_000) }).catch(
      () => null,
    );
    expect(big === null || big.status === 413).toBe(true);
    expect((await call("/containers/create", { method: "POST", body: "{}" })).status).toBe(404);
    expect((await call("/deploy")).status).toBe(404);
  });
});
