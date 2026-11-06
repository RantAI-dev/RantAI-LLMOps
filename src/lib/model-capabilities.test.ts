import { describe, expect, it } from "vitest";
import {
  modelCapabilities,
  visionFromArchitecture,
  visionFromConfig,
  visionFromModelName,
  visionFromOllama,
  visionFromPipelineTag,
} from "./model-capabilities";

describe("visionFromConfig", () => {
  it("needs a vision_config object", () => {
    expect(visionFromConfig({ vision_config: { depth: 27 } })).toBe(true);
    expect(visionFromConfig({ vision_config: null })).toBe(false);
    expect(visionFromConfig({ text_config: {} })).toBe(false);
    expect(visionFromConfig(undefined)).toBe(false);
  });
});

describe("visionFromArchitecture", () => {
  it("recognises the vision-language classes we serve and train", () => {
    for (const a of [
      "Qwen3VLForConditionalGeneration",
      "Qwen2_5_VLForConditionalGeneration",
      "Qwen2VLForConditionalGeneration",
      "Qwen3_5ForConditionalGeneration",
      "Gemma3ForConditionalGeneration",
      "LlavaForConditionalGeneration",
      "PaliGemmaForConditionalGeneration",
      "Mistral3ForConditionalGeneration",
    ]) {
      expect(visionFromArchitecture(a), a).toBe(true);
    }
    expect(visionFromArchitecture(["LlamaForCausalLM", "Qwen3VLForConditionalGeneration"])).toBe(true);
  });
  it("does not treat every *ForConditionalGeneration as vision", () => {
    for (const a of [
      "T5ForConditionalGeneration",
      "BartForConditionalGeneration",
      "WhisperForConditionalGeneration",
      "LlamaForCausalLM",
      "Qwen3ForCausalLM",
      "Gemma3ForCausalLM",
      "GGUF",
    ]) {
      expect(visionFromArchitecture(a), a).toBe(false);
    }
    expect(visionFromArchitecture(undefined)).toBe(false);
    expect(visionFromArchitecture([])).toBe(false);
  });
});

describe("visionFromPipelineTag / visionFromOllama", () => {
  it("reads the HF pipeline tag and Ollama capabilities", () => {
    expect(visionFromPipelineTag("image-text-to-text")).toBe(true);
    expect(visionFromPipelineTag("visual-question-answering")).toBe(true);
    expect(visionFromPipelineTag("text-generation")).toBe(false);
    expect(visionFromPipelineTag(null)).toBe(false);
    expect(visionFromOllama(["completion", "vision"])).toBe(true);
    expect(visionFromOllama(["completion", "tools"])).toBe(false);
    expect(visionFromOllama(undefined)).toBe(false);
  });
});

describe("modelCapabilities", () => {
  it("reports the first signal that fires", () => {
    expect(modelCapabilities({ config: { vision_config: {} } })).toEqual({
      vision: true,
      reason: "config.json has vision_config",
    });
    expect(modelCapabilities({ architecture: "Gemma3ForConditionalGeneration" }).vision).toBe(true);
    expect(modelCapabilities({ pipelineTag: "image-text-to-text" }).vision).toBe(true);
    expect(modelCapabilities({ ollamaCapabilities: ["vision"] }).vision).toBe(true);
  });
  it("is false with no signal", () => {
    expect(modelCapabilities({})).toEqual({ vision: false, reason: "no vision signal" });
    expect(modelCapabilities({ architecture: "LlamaForCausalLM", pipelineTag: "text-generation" }).vision).toBe(false);
  });
});

describe("visionFromModelName", () => {
  it.each([
    "aisingapore/Qwen-SEA-LION-v4-8B-VL",
    "aisingapore/Gemma-SEA-LION-v4-4B-VL",
    "Qwen/Qwen2.5-VL-7B-Instruct",
    "Qwen/Qwen2VL-2B",
    "Qwen/Qwen3VL-8B",
    "meta-llama/Llama-3.2-11B-Vision-Instruct",
    "microsoft/kosmos_visual_chat",
    "llava-hf/llava-1.5-7b-hf",
    "mistral-community/pixtral-12b",
    "google/paligemma-3b-pt-224",
    "HuggingFaceM4/idefics2-8b",
    "allenai/Molmo-7B-D-0924",
    "OpenGVLab/InternVL3-8B",
    "HuggingFaceTB/SmolVLM-256M",
    "some/model_vl_v2",
  ])("recognises %s", (name) => expect(visionFromModelName(name)).toBe(true));

  it.each([
    "aisingapore/Llama-SEA-LION-v3.5-8B-R",
    "mistralai/Mixtral-8x7B-v0.1",
    "Qwen/Qwen2.5-7B-Instruct",
    "meta-llama/Llama-3.1-8B",
    "someone/Devlin-7B",
    "base",
    "ask",
    "/adapters/ask",
    "",
  ])("does not match %s", (name) => expect(visionFromModelName(name)).toBe(false));

  it("is false for missing input", () => {
    expect(visionFromModelName(undefined)).toBe(false);
    expect(visionFromModelName(null)).toBe(false);
  });
});
