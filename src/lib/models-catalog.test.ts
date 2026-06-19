import { describe, expect, it } from "vitest";

import {
  loaderForArchitecture,
  recommendedWithStatus,
  RECOMMENDED,
  type CatalogModel,
} from "@/lib/models-catalog";

describe("loaderForArchitecture", () => {
  it("routes GGUF models to the llama.cpp loader", () => {
    expect(loaderForArchitecture("GGUF")).toEqual({ engine: "llama_cpp_server", isGguf: true });
    // case-insensitive
    expect(loaderForArchitecture("gguf").isGguf).toBe(true);
  });

  it("routes safetensors architectures to fastchat", () => {
    expect(loaderForArchitecture("LlamaForCausalLM")).toEqual({
      engine: "fastchat_server",
      isGguf: false,
    });
    expect(loaderForArchitecture("Qwen2ForCausalLM").isGguf).toBe(false);
    expect(loaderForArchitecture("").engine).toBe("fastchat_server");
  });
});

describe("recommendedWithStatus", () => {
  const rec = RECOMMENDED[0];

  it("flags a recommended model as downloaded when its repo is present locally", () => {
    const downloaded: CatalogModel[] = [
      {
        id: "local-id",
        name: "x",
        architecture: "GGUF",
        sizeMb: 100,
        isGguf: true,
        downloaded: true,
        hfRepo: rec.hfRepo,
      },
    ];
    const out = recommendedWithStatus(downloaded);
    expect(out.find((m) => m.id === rec.id)?.downloaded).toBe(true);
  });

  it("leaves recommended models not-downloaded when absent", () => {
    const out = recommendedWithStatus([]);
    expect(out.every((m) => m.downloaded === false)).toBe(true);
    expect(out).toHaveLength(RECOMMENDED.length);
  });
});
