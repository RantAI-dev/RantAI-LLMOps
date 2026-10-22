import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tasks-server", () => ({ listAllJobs: vi.fn() }));

import { listAllJobs } from "@/lib/tasks-server";
import {
  decisionModelDir,
  decisionServerState,
  defaultDeployName,
  deployableDecisionJobs,
  deployDecisionJob,
  DecisionServerError,
} from "@/lib/decision-server";

const JOBS = "/root/.transformerlab/orgs/o/workspace/experiments/rantai-ft/jobs";
const row = (over: Record<string, unknown>) =>
  ({ id: "j1", status: "COMPLETE", subtype: "DECISION", template: "Tiket Router", models: [], ...over }) as never;

describe("decisionModelDir", () => {
  it("picks the adapter folder, not the merged or GGUF one", () => {
    const models = [`${JOBS}/j1/models/j1_unsloth_decision_gguf`, `${JOBS}/j1/models/j1_unsloth_decision_model`];
    expect(decisionModelDir(models)).toBe(`${JOBS}/j1/models/j1_unsloth_decision_model`);
    expect(decisionModelDir([`${JOBS}/j1/models/j1_unsloth_decision_model/`])).toContain("_unsloth_decision_model/");
  });

  it("returns null when the job saved no decision model, and ignores chat adapters", () => {
    expect(decisionModelDir([])).toBeNull();
    expect(decisionModelDir([`${JOBS}/j1/models/j1_unsloth_trained_model`])).toBeNull();
    expect(decisionModelDir([`${JOBS}/j1/models/j1_unsloth_decision_merged`])).toBeNull();
  });
});

describe("defaultDeployName", () => {
  it("slugifies to a name the server accepts", () => {
    expect(defaultDeployName("Tiket Router v2!", "abcdef123456")).toBe("tiket-router-v2");
    expect(defaultDeployName("x".repeat(100), "id")).toHaveLength(48);
    expect(/^[A-Za-z0-9._-]{1,64}$/.test(defaultDeployName("Ünïcode ✓ name", "id"))).toBe(true);
  });

  it("falls back to the job id when the name has nothing usable", () => {
    expect(defaultDeployName("✓✓", "abcdef123456")).toBe("decision-abcdef12");
  });
});

describe("with a decision server", () => {
  beforeEach(() => {
    vi.stubEnv("DECISION_BASE_URL", "http://decision:8000/");
    vi.stubEnv("DECISION_ADMIN_TOKEN", "tok");
    vi.mocked(listAllJobs).mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is not configured without DECISION_BASE_URL and makes no request", async () => {
    vi.stubEnv("DECISION_BASE_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await decisionServerState()).toMatchObject({ configured: false, reachable: false, models: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports an unreachable server without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    expect(await decisionServerState()).toMatchObject({ configured: true, reachable: false, error: expect.any(String) });
  });

  it("lists the served models with the admin token, and only health without one", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/health")) return new Response("{}", { status: 200 });
      expect((init?.headers as Record<string, string>)["X-Admin-Token"]).toBe("tok");
      return Response.json({ models: [{ name: "a", loaded: true }], max_models: 3 });
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(await decisionServerState()).toMatchObject({ reachable: true, adminEnabled: true, maxModels: 3, models: [{ name: "a" }] });
    expect(fetchMock.mock.calls[0]![0]).toBe("http://decision:8000/health"); // the trailing slash is trimmed

    vi.stubEnv("DECISION_ADMIN_TOKEN", "");
    const state = await decisionServerState();
    expect(state).toMatchObject({ reachable: true, adminEnabled: false, models: [] });
  });

  it("lists only finished decision jobs that have a model folder, flagging the deployed one", async () => {
    const dir = `${JOBS}/j1/models/j1_unsloth_decision_model`;
    vi.mocked(listAllJobs).mockResolvedValue([
      row({ id: "j1", models: [dir] }),
      row({ id: "j2", models: [], template: "no model" }),
      row({ id: "j3", status: "RUNNING", models: [`${JOBS}/j3/models/j3_unsloth_decision_model`] }),
      row({ id: "j4", subtype: "TRAIN", models: [`${JOBS}/j4/models/j4_unsloth_decision_model`] }),
    ]);
    const served = [{ name: "tiket", path: dir }] as never;
    expect(await deployableDecisionJobs(served)).toEqual([{ id: "j1", name: "Tiket Router", path: dir, deployedAs: "tiket" }]);
  });

  it("deploys by job id with the recorded path, and passes the server's refusal on with its status", async () => {
    const dir = `${JOBS}/j1/models/j1_unsloth_decision_model`;
    vi.mocked(listAllJobs).mockResolvedValue([row({ id: "j1", models: [dir] })]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ name: "tiket-router", loaded: true }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ error: { message: "at most 3 models can be loaded at once" } }, { status: 409 }));
    vi.stubGlobal("fetch", fetchMock);

    await deployDecisionJob("j1", { loadIn4bit: true });
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(sent).toEqual({ name: "tiket-router", path: dir, load_in_4bit: true, max_seq_length: 4096 });

    await expect(deployDecisionJob("j1")).rejects.toMatchObject({ status: 409, message: expect.stringContaining("at most 3") });
  });

  it("refuses a job that is not a finished decision job, before asking the server", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(listAllJobs).mockResolvedValue([row({ id: "t", subtype: "TRAIN" }), row({ id: "r", status: "RUNNING" })]);
    await expect(deployDecisionJob("t")).rejects.toBeInstanceOf(DecisionServerError);
    await expect(deployDecisionJob("r")).rejects.toMatchObject({ status: 409 });
    await expect(deployDecisionJob("missing")).rejects.toMatchObject({ status: 404 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("will not deploy without the admin token", async () => {
    vi.stubEnv("DECISION_ADMIN_TOKEN", "");
    await expect(deployDecisionJob("j1")).rejects.toMatchObject({ status: 503 });
  });
});
