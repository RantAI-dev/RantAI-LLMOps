// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ guardApi: vi.fn(async () => null) }));
vi.mock("@/lib/trained-adapters", () => ({ listTrainedAdapters: vi.fn(async () => [{ jobId: "j", path: "/p", base: "b" }]) }));
const lib = vi.hoisted(() => ({ duoPairStatus: vi.fn(), startDuoDeploy: vi.fn(), rollbackDuoRole: vi.fn() }));
vi.mock("@/lib/duo-deploy", async (orig) => ({ ...(await orig<typeof import("@/lib/duo-deploy")>()), ...lib }));

import { GET, POST } from "@/app/api/duo/deploy/route";

const req = (body?: unknown) =>
  new Request("http://x/api/duo/deploy", body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) as never;

describe("/api/duo/deploy through the Duo deployer", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubEnv("DUO_DEPLOYER_URL", "http://rantai-duo-deployer:8097/");
    vi.stubEnv("DUO_DEPLOYER_TOKEN", "secret-token");
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("takes the status from the deployer and adds the adapters", async () => {
    fetchMock.mockResolvedValue(Response.json({ docker: true, roles: { s1: {} } }));
    const res = await GET(req());
    expect(await res.json()).toEqual({ docker: true, roles: { s1: {} }, adapters: [{ jobId: "j", path: "/p", base: "b" }] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://rantai-duo-deployer:8097/status");
    expect(init.headers.Authorization).toBe("Bearer secret-token");
    expect(lib.duoPairStatus).not.toHaveBeenCalled();
  });

  it("validates before forwarding a deployment", async () => {
    expect((await POST(req({ role: "s1", baseModel: "nope" }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(Response.json({ role: "s1", phase: "replacing" }, { status: 202 }));
    const res = await POST(req({ role: "s1", baseModel: "Qwen/Qwen3-1.7B" }));
    expect(res.status).toBe(202);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ role: "s1", baseModel: "Qwen/Qwen3-1.7B", adapterPath: null, maxModelLen: 8192 });
    expect(lib.startDuoDeploy).not.toHaveBeenCalled();
  });

  it("forwards a rollback and reports deployer errors", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ ok: true }));
    expect((await POST(req({ role: "s2", action: "rollback" }))).status).toBe(200);
    expect(fetchMock.mock.calls[0][0]).toBe("http://rantai-duo-deployer:8097/rollback");

    fetchMock.mockResolvedValueOnce(Response.json({ error: "No aql-s2-prev container to go back to" }, { status: 409 }));
    const res = await POST(req({ role: "s2", action: "rollback" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/aql-s2-prev/);

    fetchMock.mockResolvedValueOnce(Response.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await (await GET(req())).json()).error).toMatch(/refused the token/);

    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const down = await GET(req());
    expect(down.status).toBe(502);
    expect((await down.json()).error).toMatch(/not reachable/);
  });

  it("falls back to the local socket when no deployer is configured", async () => {
    vi.stubEnv("DUO_DEPLOYER_URL", "");
    lib.duoPairStatus.mockResolvedValue({ docker: false, roles: {} });
    expect((await (await GET(req())).json()).docker).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
