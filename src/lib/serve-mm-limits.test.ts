import { describe, expect, it } from "vitest";

import { mmLimitEnv, mmLimits } from "@/lib/serve-mm-limits";

const VL = "aisingapore/Qwen-SEA-LION-v4-8B-VL";
const TEXT = "aisingapore/Llama-SEA-LION-v3.5-8B-R";

describe("mmLimits", () => {
  it("is empty when nothing is set", () => {
    expect(mmLimits({ baseModel: VL })).toEqual({});
  });
  it("applies both limits to a vision base", () => {
    expect(mmLimits({ baseModel: VL, limitMmImages: 4, maxImagePixels: 1048576 })).toEqual({ images: 4, pixels: 1048576 });
    expect(mmLimits({ baseModel: VL, limitMmImages: 2 })).toEqual({ images: 2 });
  });
  it("applies nothing to a text base", () => {
    expect(mmLimits({ baseModel: TEXT, limitMmImages: 4, maxImagePixels: 1048576 })).toEqual({});
  });
  it("lets the caller's vision flag override the name guess", () => {
    expect(mmLimits({ baseModel: "/root/.transformerlab/models/m1", baseVision: true, limitMmImages: 3 })).toEqual({ images: 3 });
    expect(mmLimits({ baseModel: VL, baseVision: false, limitMmImages: 3 })).toEqual({});
  });
  it("treats empty values as unset", () => {
    expect(mmLimits({ baseModel: VL, limitMmImages: "" as unknown as number })).toEqual({});
  });
  it("rejects nonsense numbers", () => {
    for (const bad of [0, -1, 1.5, 65, Number.NaN, "x" as unknown as number]) {
      expect(() => mmLimits({ baseModel: VL, limitMmImages: bad })).toThrow(/Images per request/);
    }
    for (const bad of [0, 100, 1e12, 2.5]) {
      expect(() => mmLimits({ baseModel: VL, maxImagePixels: bad })).toThrow(/Max pixels per image/);
    }
  });
});

describe("mmLimitEnv", () => {
  it("names the variables per engine, only for what is set", () => {
    expect(mmLimitEnv({ baseModel: VL, limitMmImages: 4, maxImagePixels: 1048576 }, "VLLM")).toEqual([
      "VLLM_LIMIT_MM_IMAGES=4",
      "VLLM_MAX_IMAGE_PIXELS=1048576",
    ]);
    expect(mmLimitEnv({ baseModel: VL, maxImagePixels: 589824 }, "SGLANG")).toEqual(["SGLANG_MAX_IMAGE_PIXELS=589824"]);
    expect(mmLimitEnv({ baseModel: VL }, "VLLM")).toEqual([]);
    expect(mmLimitEnv({ baseModel: TEXT, limitMmImages: 4 }, "VLLM")).toEqual([]);
  });
});
