import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const docker = vi.hoisted(() => ({
  dockerAvailable: vi.fn(() => true),
  dockerInspect: vi.fn(),
  dockerCreate: vi.fn(),
  dockerStart: vi.fn(),
  dockerStop: vi.fn(),
  dockerRemove: vi.fn(),
  dockerRename: vi.fn(),
  dockerUpdate: vi.fn(),
}));
vi.mock("@/lib/docker-client", () => docker);

import { containerBody, type DuoDeployJob, parseDuoDeployRequest, readCurrent, runDuoDeploy, vllmArgs } from "@/lib/duo-deploy";

// `docker inspect aql-s1` on the GB10 (18 Nov 2026), trimmed.
const S1 = {
  Config: {
    Image: "vllm/vllm-openai:cu130-nightly",
    Entrypoint: ["vllm", "serve"],
    Env: ["PATH=/usr/bin"],
    Cmd: "Qwen/Qwen3-1.7B --served-model-name system1 --port 8001 --dtype bfloat16 --max-model-len 8192 --max-num-seqs 4 --enable-prefix-caching --enable-prompt-tokens-details --max-logprobs 5 --gpu-memory-utilization 0.08".split(" "),
  },
  State: { Running: true, Status: "running" },
  HostConfig: { NetworkMode: "rantai-llmops_llmops", IpcMode: "host", DeviceRequests: [{ Driver: "nvidia", Count: -1, Capabilities: [["gpu"]] }] },
  Mounts: [{ Type: "volume", Name: "rantai-llmops_vllm_hf_cache", Source: "/var/lib/docker/volumes/x/_data", Destination: "/root/.cache/huggingface", RW: true }],
  NetworkSettings: { Networks: { "rantai-llmops_llmops": { Aliases: ["aql-s1"] } } },
};
const ADAPTER = "/root/.transformerlab/orgs/o/workspace/experiments/rantai-ft/jobs/abcd1234-0000/models/abcd1234-0000_unsloth_trained_model";

describe("parseDuoDeployRequest", () => {
  it("accepts a Hugging Face id and an adapter under the TL data", () => {
    expect(parseDuoDeployRequest({ role: "s1", baseModel: "Qwen/Qwen3-1.7B", adapterPath: ADAPTER })).toEqual({
      role: "s1",
      baseModel: "Qwen/Qwen3-1.7B",
      adapterPath: ADAPTER,
      maxModelLen: 8192,
    });
  });

  it("refuses anything that could reach a shell or another path", () => {
    for (const b of [
      { role: "s3", baseModel: "Qwen/Qwen3-1.7B" },
      { role: "s1", baseModel: "Qwen3-1.7B" },
      { role: "s1", baseModel: "Qwen/Qwen3; rm -rf /" },
      { role: "s1", baseModel: "Qwen/Qwen3-1.7B", adapterPath: "/etc/passwd" },
      { role: "s1", baseModel: "Qwen/Qwen3-1.7B", adapterPath: "/root/.transformerlab/../x" },
      { role: "s1", baseModel: "Qwen/Qwen3-1.7B", maxModelLen: 100 },
    ]) {
      expect(() => parseDuoDeployRequest(b), JSON.stringify(b)).toThrow();
    }
  });
});

describe("vllm arguments and the container", () => {
  it("serves System 1 without a reasoning parser and System 2 with one, under the names the gateway calls", () => {
    const s1 = vllmArgs("s1", { baseModel: "Qwen/Qwen3-1.7B", adapterPath: null, maxModelLen: 8192 });
    expect(s1.slice(0, 5)).toEqual(["Qwen/Qwen3-1.7B", "--served-model-name", "system1", "--port", "8001"]);
    expect(s1).not.toContain("--reasoning-parser");
    expect(s1).toEqual(expect.arrayContaining(["--enable-prefix-caching", "--enable-prompt-tokens-details"]));
    const s2 = vllmArgs("s2", { baseModel: "Qwen/Qwen3-4B-Thinking-2507", adapterPath: null, maxModelLen: 8192 });
    expect(s2.join(" ")).toContain("--served-model-name system2 --port 8002");
    expect(s2.join(" ")).toContain("--reasoning-parser qwen3");
  });

  it("with an adapter, serves the base aside and the adapter under the gateway's name", () => {
    const a = vllmArgs("s1", { baseModel: "Qwen/Qwen3-1.7B", adapterPath: ADAPTER, maxModelLen: 8192 }).join(" ");
    expect(a).toContain("--served-model-name system1-base");
    expect(a).toContain(`--enable-lora --max-lora-rank 64 --lora-modules system1=${ADAPTER}`);
  });

  it("reads what a container serves", () => {
    expect(readCurrent(S1)).toEqual({ exists: true, running: true, image: "vllm/vllm-openai:cu130-nightly", baseModel: "Qwen/Qwen3-1.7B", adapterPath: null, maxModelLen: 8192 });
    const withAdapter = { ...S1, Config: { ...S1.Config, Cmd: vllmArgs("s1", { baseModel: "Qwen/Qwen3-1.7B", adapterPath: ADAPTER, maxModelLen: 4096 }) } };
    expect(readCurrent(withAdapter)).toMatchObject({ adapterPath: ADAPTER, maxModelLen: 4096 });
    expect(readCurrent(null)).toMatchObject({ exists: false, running: false, baseModel: null });
  });

  it("keeps the image, GPU, IPC and every mount by name, and adds the TL data for an adapter", () => {
    const b = containerBody("s1", S1, { role: "s1", baseModel: "Qwen/Qwen3-1.7B", adapterPath: ADAPTER, maxModelLen: 8192 }) as {
      Image: string;
      Entrypoint: string[];
      HostConfig: { Mounts: unknown[]; IpcMode: string; DeviceRequests: unknown; RestartPolicy: unknown; NetworkMode: string };
      NetworkingConfig: unknown;
    };
    expect(b.Image).toBe("vllm/vllm-openai:cu130-nightly");
    expect(b.Entrypoint).toEqual(["vllm", "serve"]);
    expect(b.HostConfig.Mounts).toEqual([
      { Type: "volume", Source: "rantai-llmops_vllm_hf_cache", Target: "/root/.cache/huggingface", ReadOnly: false },
      { Type: "volume", Source: "rantai-llmops_tl_data", Target: "/root/.transformerlab", ReadOnly: true },
    ]);
    expect(b.HostConfig).toMatchObject({ IpcMode: "host", NetworkMode: "rantai-llmops_llmops", RestartPolicy: { Name: "unless-stopped" } });
    expect(b.NetworkingConfig).toEqual({ EndpointsConfig: { "rantai-llmops_llmops": { Aliases: ["aql-s1"] } } });
  });
});

describe("runDuoDeploy", () => {
  const fetchMock = vi.fn();
  const ok = (status = 204) => Promise.resolve({ status, text: "", json: null });
  let containers: Record<string, unknown>;
  const job = (): DuoDeployJob => ({
    role: "s1",
    request: { role: "s1", baseModel: "Qwen/Qwen3-1.7B", adapterPath: ADAPTER, maxModelLen: 8192 },
    phase: "replacing",
    message: "",
    startedAt: 0,
    finishedAt: null,
  });

  beforeEach(() => {
    containers = { "aql-s1": S1 };
    docker.dockerInspect.mockImplementation((n: string) =>
      Promise.resolve(containers[n] ? { status: 200, text: "", json: containers[n] } : { status: 404, text: "", json: { message: "no such container" } })
    );
    docker.dockerStop.mockImplementation(() => ok());
    docker.dockerRemove.mockImplementation((n: string) => {
      delete containers[n];
      return ok();
    });
    docker.dockerRename.mockImplementation((from: string, to: string) => {
      containers[to] = containers[from];
      delete containers[from];
      return ok();
    });
    docker.dockerUpdate.mockImplementation(() => ok(200));
    docker.dockerCreate.mockImplementation((n: string, body: { Cmd: string[] }) => {
      containers[n] = { ...S1, Config: { ...S1.Config, Cmd: body.Cmd } };
      return Promise.resolve({ status: 201, text: "", json: { Id: "new" } });
    });
    docker.dockerStart.mockImplementation(() => ok());
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    vi.clearAllMocks();
  });

  it("replaces the container, keeps the old one as -prev, and is ready when the gateway's name answers", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "system1-base" }, { id: "system1" }] })));
    const j = job();
    await runDuoDeploy(j, { timeoutMs: 1000, pollMs: 1 });
    expect(j.phase).toBe("ready");
    expect(Object.keys(containers).sort()).toEqual(["aql-s1", "aql-s1-prev"]);
    expect(docker.dockerUpdate).toHaveBeenCalledWith("aql-s1-prev", { RestartPolicy: { Name: "no" } });
    expect(readCurrent(containers["aql-s1"]).adapterPath).toBe(ADAPTER);
    expect(fetchMock.mock.calls[0][0]).toBe("http://aql-s1:8001/v1/models");
  });

  it("brings the previous container back when the new model never answers", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "something-else" }] })));
    const j = job();
    await runDuoDeploy(j, { timeoutMs: 30, pollMs: 5 });
    expect(j.phase).toBe("rolled_back");
    expect(Object.keys(containers)).toEqual(["aql-s1"]);
    expect(readCurrent(containers["aql-s1"]).adapterPath).toBeNull(); // the old one, base only
    expect(docker.dockerStart).toHaveBeenLastCalledWith("aql-s1");
  });

  it("refuses to touch a role whose container does not exist", async () => {
    containers = {};
    const j = job();
    await runDuoDeploy(j, { timeoutMs: 10, pollMs: 1 });
    expect(j.phase).toBe("failed");
    expect(docker.dockerCreate).not.toHaveBeenCalled();
  });
});
