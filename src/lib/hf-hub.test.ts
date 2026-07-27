import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  quantFromFile,
  searchHfDatasets,
  searchHfTrainableModels,
} from "@/lib/hf-hub";

vi.mock("@/lib/settings-store", () => ({
  getHfToken: vi.fn().mockResolvedValue(null),
}));

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("quantFromFile", () => {
  it("extracts common quant tags from GGUF filenames", () => {
    expect(quantFromFile("Llama-3.2-1B-Instruct-Q4_K_M.gguf")).toBe("Q4_K_M");
    expect(quantFromFile("Model-Q4_0.gguf")).toBe("Q4_0");
    expect(quantFromFile("Model-Q8_0.gguf")).toBe("Q8_0");
    expect(quantFromFile("Model-Q5_K_S.gguf")).toBe("Q5_K_S");
  });

  it("handles IQ and float variants", () => {
    expect(quantFromFile("Llama-3.2-1B-Instruct-IQ3_M.gguf")).toBe("IQ3_M");
    expect(quantFromFile("Model-IQ4_XS.gguf")).toBe("IQ4_XS");
    expect(quantFromFile("Model-f16.gguf")).toBe("F16");
    expect(quantFromFile("Model-BF16.gguf")).toBe("BF16");
  });

  it("is case-insensitive on the .gguf extension and uppercases the quant", () => {
    expect(quantFromFile("Model-q4_k_m.GGUF")).toBe("Q4_K_M");
  });

  it("falls back to the last segment when no quant token is present", () => {
    expect(quantFromFile("some-model-name.gguf")).toBe("NAME");
  });
});

describe("Hugging Face search queries", () => {
  it("sends dataset category and sort filters to the Hub API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    await searchHfDatasets({
      search: "alpaca",
      filter: "task_categories:text-generation",
      sort: "likes",
    });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("search")).toBe("alpaca");
    expect(url.searchParams.get("filter")).toBe("task_categories:text-generation");
    expect(url.searchParams.get("sort")).toBe("likes");
  });

  it("honors the selected sort for safetensors models", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    await searchHfTrainableModels({ search: "qwen", sort: "modified" });

    const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("search")).toBe("qwen");
    expect(url.searchParams.get("sort")).toBe("lastModified");
  });
});
