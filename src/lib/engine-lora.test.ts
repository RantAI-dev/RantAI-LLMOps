import { afterEach, describe, expect, it, vi } from "vitest";

import { attachAdapter, detachAdapter, listSglangDiskAdapters, sglangHelperUrl, sglangRoot } from "@/lib/engine-lora";
import type { ResolvedEngine } from "@/lib/inference-engines";

const SGL: ResolvedEngine = { id: "sglang", label: "SGLang", v1BaseUrl: "http://sglang8b:30000/v1", configured: true, headers: {} };

function mockFetch(handler: (url: string, body: unknown) => { status?: number; json: unknown }) {
  const calls: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      const r = handler(url, body);
      return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
    })
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("SGLang URLs", () => {
  it("puts admin calls at the server root and the helper on port 30001", () => {
    expect(sglangRoot("http://sglang8b:30000/v1")).toBe("http://sglang8b:30000");
    expect(sglangHelperUrl("http://sglang8b:30000/v1")).toBe("http://sglang8b:30001");
  });
});

describe("attachAdapter (SGLang)", () => {
  it("loads the copy the helper prepared", async () => {
    const calls = mockFetch((url) =>
      url.endsWith("/prepare") ? { json: { path: "/tmp/loras-hot/quiz" } } : { json: { success: true, loaded_adapters: {} } }
    );
    const res = await attachAdapter("sglang", SGL, "quiz", "/root/.transformerlab/a");
    expect(res.ok).toBe(true);
    expect(calls.map((c) => c.url)).toEqual(["http://sglang8b:30001/prepare", "http://sglang8b:30000/load_lora_adapter"]);
    expect(calls[1]!.body).toEqual({ lora_name: "quiz", lora_path: "/tmp/loras-hot/quiz" });
  });

  it("falls back to the trained dir without a helper and explains a refusal", async () => {
    const calls = mockFetch((url) =>
      url.endsWith("/prepare")
        ? { status: 404, json: {} }
        : { status: 400, json: { success: false, error_message: "Only 'all' or 'all-linear' can be used" } }
    );
    const res = await attachAdapter("sglang", SGL, "quiz", "/root/.transformerlab/a");
    expect(res.ok).toBe(false);
    expect(calls[1]!.body).toEqual({ lora_name: "quiz", lora_path: "/root/.transformerlab/a" });
    expect(res.message).toMatch(/Only 'all'.*adapter helper on port 30001/);
  });

  it("reports SGLang's own message when an unload fails", async () => {
    mockFetch(() => ({ status: 400, json: { success: false, error_message: "LoRA adapter nope not loaded" } }));
    expect(await detachAdapter("sglang", SGL, "nope")).toMatchObject({ ok: false, message: "LoRA adapter nope not loaded" });
  });
});

describe("listSglangDiskAdapters", () => {
  it("keeps the job id and base of each trained adapter", async () => {
    mockFetch(() => ({
      json: { adapters: [{ path: "/root/.transformerlab/orgs/o/workspace/experiments/e/jobs/abc/models/m", base: "org/base" }] },
    }));
    expect(await listSglangDiskAdapters(SGL.v1BaseUrl)).toEqual([
      { jobId: "abc", path: "/root/.transformerlab/orgs/o/workspace/experiments/e/jobs/abc/models/m", base: "org/base" },
    ]);
  });
});
