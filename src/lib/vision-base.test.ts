import { describe, expect, it, vi } from "vitest";

import { visionBaseProblem, visionDatasetRefProblem, visionParamProblems } from "@/lib/vision-base";

function cfgFetch(body: unknown, ok = true): typeof fetch {
  return vi.fn(async () => ({ ok, json: async () => body }) as Response) as unknown as typeof fetch;
}

describe("visionBaseProblem", () => {
  it("accepts a config with vision_config", async () => {
    const f = cfgFetch({ architectures: ["Gemma3ForConditionalGeneration"], vision_config: { hidden_size: 1152 } });
    expect(await visionBaseProblem("aisingapore/Gemma-SEA-LION-v4-4B-VL", { fetchImpl: f })).toBeNull();
  });

  it("accepts a VL architecture without vision_config", async () => {
    const f = cfgFetch({ architectures: ["Qwen3VLForConditionalGeneration"] });
    expect(await visionBaseProblem("aisingapore/Qwen-SEA-LION-v4-8B-VL", { fetchImpl: f })).toBeNull();
  });

  it("refuses a text-only base with a clear message", async () => {
    const f = cfgFetch({ architectures: ["Qwen2ForCausalLM"] });
    const msg = await visionBaseProblem("unsloth/Qwen2.5-0.5B-Instruct", { fetchImpl: f });
    expect(msg).toContain("not a vision-language model");
    expect(msg).toContain("unsloth/Qwen2.5-0.5B-Instruct");
    expect(msg).toContain("aisingapore/Gemma-SEA-LION-v4-4B-VL");
  });

  it("sends the HF token and asks for the repo's config.json", async () => {
    const f = cfgFetch({ vision_config: {} });
    await visionBaseProblem("owner/name", { fetchImpl: f, token: "hf_x" });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://huggingface.co/owner/name/resolve/main/config.json");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer hf_x");
  });

  it("does not refuse what it cannot check: Hub error, network failure, local path", async () => {
    expect(await visionBaseProblem("owner/gated", { fetchImpl: cfgFetch({}, false) })).toBeNull();
    const boom = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await visionBaseProblem("owner/name", { fetchImpl: boom })).toBeNull();
    const never = vi.fn() as unknown as typeof fetch;
    expect(await visionBaseProblem("/models/my-vl", { fetchImpl: never })).toBeNull();
    expect(never).not.toHaveBeenCalled();
  });
});

describe("visionParamProblems", () => {
  it("passes sane values and absent ones", () => {
    expect(visionParamProblems({})).toEqual([]);
    expect(visionParamProblems({ maxPixels: 1003520, maxImagesPerSample: 4, gradientAccumulationSteps: 8, batchSize: 1, maxSeqLength: 4096 })).toEqual([]);
  });

  it("names each bad knob", () => {
    const p = visionParamProblems({ maxPixels: 10, maxImagesPerSample: 99, gradientAccumulationSteps: 0, batchSize: 1.5, maxSeqLength: 100 });
    expect(p).toHaveLength(5);
    expect(p.join(" ")).toMatch(/maxPixels.*maxImagesPerSample.*gradientAccumulationSteps.*batchSize.*maxSeqLength/);
  });

  it("accepts 0 (no limit) and positive row caps, refuses negative or fractional ones", () => {
    expect(visionParamProblems({ maxTrainRows: 0, maxEvalRows: 300 })).toEqual([]);
    expect(visionParamProblems({ maxTrainRows: -1, maxEvalRows: 2.5 })).toHaveLength(2);
  });
});

describe("visionDatasetRefProblem", () => {
  it("refuses http(s) URLs only", () => {
    expect(visionDatasetRefProblem("https://x.com/train.jsonl")).toContain("http(s) URL");
    expect(visionDatasetRefProblem("s3://bucket/vision/ds/")).toBeNull();
    expect(visionDatasetRefProblem("unsloth/LaTeX_OCR")).toBeNull();
    expect(visionDatasetRefProblem("my-dataset")).toBeNull();
  });
});
