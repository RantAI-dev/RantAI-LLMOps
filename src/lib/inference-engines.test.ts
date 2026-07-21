import { afterEach, describe, expect, it, vi } from "vitest";

// Ollama + inference config are read at import time via env; the helpers under
// test are pure given those, so stub the network-touching Ollama module.
vi.mock("@/lib/ollama", () => ({
  OLLAMA_V1: "http://localhost:11434/v1",
  listOllamaModels: vi.fn(async () => [{ id: "qwen2.5:0.5b", name: "qwen2.5:0.5b", sizeMb: 400 }]),
  loadedOllamaModel: vi.fn(async () => "qwen2.5:0.5b"),
  ollamaUp: vi.fn(async () => true),
}));

import { resolveChatModel, resolveEngine } from "@/lib/inference-engines";

afterEach(() => vi.restoreAllMocks());

describe("resolveEngine", () => {
  it("defaults to Ollama when no engine is named", () => {
    const e = resolveEngine(undefined);
    expect(e.id).toBe("ollama");
    expect(e.configured).toBe(true);
    expect(e.v1BaseUrl).toBe("http://localhost:11434/v1");
  });

  it("falls back to Ollama for an unknown engine id", () => {
    expect(resolveEngine("does-not-exist").id).toBe("ollama");
  });

  it("resolves vLLM but marks it unconfigured without VLLM_BASE_URL", () => {
    // VLLM_BASE_URL is unset in the test env, so vLLM has no base URL.
    const e = resolveEngine("vllm");
    expect(e.id).toBe("vllm");
    expect(e.configured).toBe(false);
    expect(e.v1BaseUrl).toBe("");
  });

  it("Ollama carries no auth header (keyless)", () => {
    expect(resolveEngine("ollama").headers.Authorization).toBeUndefined();
  });
});

describe("resolveChatModel", () => {
  it("honours the client's explicit model over everything", async () => {
    const model = await resolveChatModel(resolveEngine("ollama"), "llama3.2:1b");
    expect(model).toBe("llama3.2:1b");
  });

  it("falls back to the hot Ollama model when the client sends none", async () => {
    const model = await resolveChatModel(resolveEngine("ollama"), undefined);
    expect(model).toBe("qwen2.5:0.5b");
  });
});
