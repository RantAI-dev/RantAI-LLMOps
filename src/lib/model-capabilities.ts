/**
 * What a model can do, beyond text. One place decides "does this model take images?", so the
 * Playground, Fine-tune and Evals agree.
 *
 * Signals, strongest first:
 *  1. `config.json` has a `vision_config` object.
 *  2. The architecture is a known vision-language class (Qwen*VL, Gemma3ForConditionalGeneration, ...).
 *  3. The Hugging Face `pipeline_tag` is `image-text-to-text` / `visual-question-answering`.
 *  4. Ollama lists the `vision` capability.
 *
 * Architecture matching is an allowlist on purpose: a bare `*ForConditionalGeneration` would also
 * match T5, BART and Whisper, which are not vision models.
 */

export type Capabilities = { vision: boolean; reason: string };

const VISION_ARCH =
  /(Qwen\d+(?:_?\d+)?_?VL|Qwen3_?5\w*ForConditionalGeneration|Gemma3n?ForConditionalGeneration|Llava|PaliGemma|Idefics|Pixtral|Mllama|InternVL|MiniCPM_?V|Phi3V|Phi4Multimodal|Llama4ForConditionalGeneration|Mistral3ForConditionalGeneration|Molmo|SmolVLM|AyaVision|Glm4v|Ovis|KimiVL|DeepseekVL|Florence2)/i;

const VISION_PIPELINE_TAGS = new Set(["image-text-to-text", "visual-question-answering"]);

export function visionFromConfig(config: unknown): boolean {
  const vc = (config as { vision_config?: unknown } | null | undefined)?.vision_config;
  return typeof vc === "object" && vc !== null;
}

export function visionFromArchitecture(arch: string | string[] | undefined | null): boolean {
  const list = Array.isArray(arch) ? arch : arch ? [arch] : [];
  return list.some((a) => VISION_ARCH.test(a));
}

export function visionFromPipelineTag(tag: string | undefined | null): boolean {
  return !!tag && VISION_PIPELINE_TAGS.has(tag);
}

export function visionFromOllama(capabilities: string[] | undefined | null): boolean {
  return !!capabilities?.includes("vision");
}

// A VL marker is a whole word: not preceded or followed by a letter, so "Qwen3-VL" and "Qwen2.5VL"
// match but "Mixtral" and "Devlin" do not. Digits and `-_./` count as separators.
const VISION_NAME =
  /(?<![a-z])(?:vl|vision|visual|llava|pixtral|paligemma|idefics|molmo|internvl|smolvlm)(?![a-z])/i;

/**
 * Best guess from a Hugging Face repo id such as "aisingapore/Qwen-SEA-LION-v4-8B-VL". vLLM and SGLang
 * do not report capabilities, so for them the name is all there is. Only a positive answer means
 * something: a name that does not match says nothing.
 */
export function visionFromModelName(name: string | undefined | null): boolean {
  return !!name && VISION_NAME.test(name);
}

export type CapabilitySource = {
  config?: unknown;
  architecture?: string | string[] | null;
  pipelineTag?: string | null;
  ollamaCapabilities?: string[] | null;
};

export function modelCapabilities(src: CapabilitySource): Capabilities {
  if (visionFromConfig(src.config)) return { vision: true, reason: "config.json has vision_config" };
  if (visionFromArchitecture(src.architecture)) return { vision: true, reason: "vision-language architecture" };
  if (visionFromPipelineTag(src.pipelineTag)) return { vision: true, reason: `pipeline_tag ${src.pipelineTag}` };
  if (visionFromOllama(src.ollamaCapabilities)) return { vision: true, reason: "Ollama capability: vision" };
  return { vision: false, reason: "no vision signal" };
}
