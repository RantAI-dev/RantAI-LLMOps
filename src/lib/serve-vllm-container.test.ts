import { describe, expect, it } from "vitest";

import { ENTRYPOINT_SCRIPT, vllmEnv } from "@/lib/serve-vllm-container";

describe("vllmEnv", () => {
  it("keeps the defaults and adds no multimodal variable unless asked", () => {
    const env = vllmEnv({ baseModel: "aisingapore/Qwen-SEA-LION-v4-8B-VL" });
    expect(env).toContain("VLLM_MODEL=aisingapore/Qwen-SEA-LION-v4-8B-VL");
    expect(env).toContain("VLLM_SERVED_NAME=base");
    expect(env).toContain("VLLM_GPU_UTIL=0.30");
    expect(env).toContain("VLLM_MAX_MODEL_LEN=8192");
    expect(env.some((e) => /LIMIT_MM|MAX_IMAGE_PIXELS/.test(e))).toBe(false);
  });

  it("passes the multimodal limits of a vision base", () => {
    const env = vllmEnv({ baseModel: "aisingapore/Gemma-SEA-LION-v4-4B-VL", limitMmImages: 4, maxImagePixels: 1048576 });
    expect(env).toContain("VLLM_LIMIT_MM_IMAGES=4");
    expect(env).toContain("VLLM_MAX_IMAGE_PIXELS=1048576");
  });

  it("drops them for a text base", () => {
    const env = vllmEnv({ baseModel: "aisingapore/Llama-SEA-LION-v3.5-8B-R", limitMmImages: 4, maxImagePixels: 1048576 });
    expect(env.some((e) => /LIMIT_MM|MAX_IMAGE_PIXELS/.test(e))).toBe(false);
  });

  it("refuses an invalid limit instead of starting an engine that will not boot", () => {
    expect(() => vllmEnv({ baseModel: "x/y-VL", limitMmImages: 0 })).toThrow(/Images per request/);
  });
});

describe("ENTRYPOINT_SCRIPT", () => {
  it("reads the multimodal numbers from env and builds the JSON itself", () => {
    expect(ENTRYPOINT_SCRIPT).toContain("--limit-mm-per-prompt");
    expect(ENTRYPOINT_SCRIPT).toContain("--mm-processor-kwargs");
  });
});
