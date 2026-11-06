import { afterEach, describe, expect, it, vi } from "vitest";

// Ollama + inference config are read at import time via env; the helpers under
// test are pure given those, so stub the network-touching Ollama module.
vi.mock("@/lib/ollama", () => ({
  OLLAMA_V1: "http://localhost:11434/v1",
  listOllamaModels: vi.fn(async () => [
    { id: "qwen2.5:0.5b", name: "qwen2.5:0.5b", sizeMb: 400, capabilities: ["completion"] },
  ]),
  loadedOllamaModel: vi.fn(async () => "qwen2.5:0.5b"),
  ollamaUp: vi.fn(async () => true),
}));

import {
  engineRequestModel,
  modelKnownTextOnly,
  resolveChatModel,
  resolveEngine,
  sglangRequestModel,
  type ResolvedEngine,
  type ServedModel,
  withNameVision,
} from "@/lib/inference-engines";
import { listOllamaModels } from "@/lib/ollama";

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

  it("resolves SGLang but marks it unconfigured without SGLANG_BASE_URL", () => {
    const e = resolveEngine("sglang");
    expect(e.id).toBe("sglang");
    expect(e.label).toBe("SGLang");
    expect(e.configured).toBe(false);
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
      { id: "qwen2.5:3b-instruct", name: "qwen2.5:3b-instruct", sizeMb: 1900, capabilities: ["completion"] },
    ]);
    const model = await resolveChatModel(resolveEngine("ollama"), undefined);
    // Not the unpulled env value — an installed model instead.
    expect(model).toBe("qwen2.5:3b-instruct");
  });

  // Regression: the fallback picked bge-m3, an embedding model, which answers
  // `/api/tags` like any other but rejects chat with "does not support chat".
  it("skips embedding-only models when falling back", async () => {
    const ollama = await import("@/lib/ollama");
    vi.mocked(ollama.loadedOllamaModel).mockResolvedValueOnce(null);
    vi.mocked(ollama.listOllamaModels).mockResolvedValueOnce([
      { id: "bge-m3:latest", name: "bge-m3:latest", sizeMb: 1200, capabilities: ["embedding"] },
      { id: "qwen2.5:3b-instruct", name: "qwen2.5:3b-instruct", sizeMb: 1900, capabilities: ["completion"] },
    ]);
    const model = await resolveChatModel(resolveEngine("ollama"), undefined);
    expect(model).toBe("qwen2.5:3b-instruct");
  });

  it("still prefers INFERENCE_MODEL when Ollama really has it", async () => {
    const ollama = await import("@/lib/ollama");
    vi.mocked(ollama.loadedOllamaModel).mockResolvedValueOnce(null);
    vi.mocked(ollama.listOllamaModels).mockResolvedValueOnce([
      { id: "qwen2.5:0.5b", name: "qwen2.5:0.5b", sizeMb: 400, capabilities: ["completion"] },
      { id: "other:1b", name: "other:1b", sizeMb: 900, capabilities: ["completion"] },
    ]);
    const model = await resolveChatModel(resolveEngine("ollama"), undefined);
    expect(model).toBe("qwen2.5:0.5b");
  });
});

// SGLang's /v1/models: the base, then each LoRA adapter with `parent` = the base.
const SGLANG_SERVED: ServedModel[] = [
  { id: "base", name: "base", isGguf: false, root: "base" },
  { id: "ask", name: "ask", isGguf: false, root: "/tmp/loras/ask", parent: "base" },
  { id: "practice", name: "practice", isGguf: false, root: "/tmp/loras/practice", parent: "base" },
];

describe("sglangRequestModel", () => {
  it("keeps the base and qualifies an adapter as <base>:<adapter>", () => {
    expect(sglangRequestModel("base", SGLANG_SERVED)).toBe("base");
    expect(sglangRequestModel("ask", SGLANG_SERVED)).toBe("base:ask");
  });

  it("passes an already-qualified loaded adapter through", () => {
    expect(sglangRequestModel("base:practice", SGLANG_SERVED)).toBe("base:practice");
  });

  // SGLang answers these with the base model and HTTP 200, so they must be refused.
  it("refuses names SGLang does not serve", () => {
    expect(sglangRequestModel("learn", SGLANG_SERVED)).toBeNull();
    expect(sglangRequestModel("base:learn", SGLANG_SERVED)).toBeNull();
    expect(sglangRequestModel("nope", SGLANG_SERVED)).toBeNull();
    expect(sglangRequestModel("ask", [])).toBeNull();
  });
});

describe("engineRequestModel", () => {
  const sglang: ResolvedEngine = { id: "sglang", label: "SGLang", v1BaseUrl: "http://sgl:30000/v1", configured: true, headers: {} };
  const models = () =>
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: SGLANG_SERVED.map(({ id, root, parent }) => ({ id, root, parent })) }))
    );

  it("rewrites an SGLang adapter pick to the wire name", async () => {
    models();
    expect(await engineRequestModel(sglang, "ask")).toEqual({ model: "base:ask" });
  });

  it("returns an error listing what SGLang serves for an unknown name", async () => {
    models();
    const r = await engineRequestModel(sglang, "learn");
    expect(r.error).toContain('"learn"');
    expect(r.error).toContain("base, ask, practice");
  });

  it("leaves other engines' names alone without a lookup", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    expect(await engineRequestModel(resolveEngine("vllm"), "ask")).toEqual({ model: "ask" });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("withNameVision", () => {
  const served = (...ids: Array<[string, string?]>): ServedModel[] =>
    ids.map(([id, root]) => ({ id, name: id, isGguf: false, root }));

  it("marks a vLLM base and its adapters from the base's HF repo id", () => {
    const out = withNameVision(served(["base", "aisingapore/Qwen-SEA-LION-v4-8B-VL"], ["ask", "/adapters/ask"]));
    expect(out.map((m) => m.vision)).toEqual([true, true]);
  });
  it("leaves a text-looking base as unknown, not false", () => {
    const out = withNameVision(served(["base", "aisingapore/Llama-SEA-LION-v3.5-8B-R"], ["ask", "/adapters/ask"]));
    expect(out.every((m) => m.vision === undefined)).toBe(true);
  });
  it("uses the real model path for SGLang, whose root is the served name", () => {
    const out = withNameVision(served(["base", "base"]), "aisingapore/Gemma-SEA-LION-v4-4B-VL");
    expect(out[0].vision).toBe(true);
  });
  it("handles an empty list", () => {
    expect(withNameVision([])).toEqual([]);
  });
});

describe("modelKnownTextOnly", () => {
  const ollama = resolveEngine("ollama");
  it("is true only for an Ollama model that lists capabilities without vision", async () => {
    expect(await modelKnownTextOnly(ollama, "qwen2.5:0.5b")).toBe(true);
    expect(await modelKnownTextOnly(ollama, "qwen2.5:0.5b:latest")).toBe(true); // `:latest` is implied
  });
  it("is false for a vision model, an unlisted one, and one with no capability list", async () => {
    vi.mocked(listOllamaModels).mockResolvedValue([
      { id: "llava:7b", name: "llava:7b", sizeMb: 1, capabilities: ["completion", "vision"] },
      { id: "old:1b", name: "old:1b", sizeMb: 1, capabilities: [] },
    ]);
    expect(await modelKnownTextOnly(ollama, "llava:7b")).toBe(false);
    expect(await modelKnownTextOnly(ollama, "old:1b")).toBe(false);
    expect(await modelKnownTextOnly(ollama, "ghost")).toBe(false);
  });
  it("never refuses vLLM or SGLang, which do not report capabilities", async () => {
    expect(await modelKnownTextOnly({ ...ollama, id: "vllm" }, "base")).toBe(false);
    expect(await modelKnownTextOnly({ ...ollama, id: "sglang" }, "base")).toBe(false);
  });
});
