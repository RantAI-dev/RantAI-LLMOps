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

  // Regression: INFERENCE_MODEL named a model that was never pulled, so opening
  // Interact without picking one returned a bare 404 from Ollama (found by the
  // end-to-end run on 24 Sep 2026 against the UGM box).
  it("ignores an INFERENCE_MODEL that Ollama does not actually have", async () => {
    const ollama = await import("@/lib/ollama");
    vi.mocked(ollama.loadedOllamaModel).mockResolvedValueOnce(null);
    vi.mocked(ollama.listOllamaModels).mockResolvedValueOnce([
      { id: "qwen2.5:3b-instruct", name: "qwen2.5:3b-instruct", sizeMb: 1900 },
    ]);
    const model = await resolveChatModel(resolveEngine("ollama"), undefined);
    // Not the unpulled env value — an installed model instead.
    expect(model).toBe("qwen2.5:3b-instruct");
  });

  it("still prefers INFERENCE_MODEL when Ollama really has it", async () => {
    const ollama = await import("@/lib/ollama");
    vi.mocked(ollama.loadedOllamaModel).mockResolvedValueOnce(null);
    vi.mocked(ollama.listOllamaModels).mockResolvedValueOnce([
      { id: "qwen2.5:0.5b", name: "qwen2.5:0.5b", sizeMb: 400 },
      { id: "other:1b", name: "other:1b", sizeMb: 900 },
    ]);
    const model = await resolveChatModel(resolveEngine("ollama"), undefined);
    expect(model).toBe("qwen2.5:0.5b");
  });
});
