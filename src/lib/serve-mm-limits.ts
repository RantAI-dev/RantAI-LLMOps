/**
 * Multimodal limits for the serving engines (D5). A vision-language model turns every image into
 * tokens (Qwen3-VL: about one per 32x32 px), and the context is only 8192, so an engine that takes
 * whatever it is sent can be filled by one big picture. Two knobs, both optional:
 *
 *  - images per request   vLLM `--limit-mm-per-prompt '{"image":N}'`
 *                         SGLang `--limit-mm-data-per-request '{"image":N}'`
 *  - max pixels per image vLLM `--mm-processor-kwargs '{"max_pixels":N}'`
 *                         SGLang `--mm-process-config '{"image":{"max_pixels":N}}'`
 *  (flag names checked on the box: vLLM 0.19.2rc1, SGLang 0.5.23; see docs/RENCANA-VLM.md, Fase 0.4.)
 *
 * They reach the container as plain numbers in env vars, and the entrypoint wraps them in the JSON;
 * nothing here ever puts JSON through a shell. They apply only to a vision base: on a text model the
 * flags mean nothing and an unknown flag value can stop the engine from starting.
 */
import { visionFromModelName } from "@/lib/model-capabilities";

export type MmLimitInput = {
  baseModel: string;
  /** Set by a caller that knows (the model catalog); otherwise guessed from the model name. */
  baseVision?: boolean;
  limitMmImages?: number;
  maxImagePixels?: number;
};

export type MmLimits = { images?: number; pixels?: number };

const MAX_IMAGES = 64;
const MAX_PIXELS = 268_435_456; // 16384 x 16384

function whole(name: string, v: unknown, min: number, max: number): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  }
  return n;
}

/** The limits to apply: `{}` for a base that is not a vision model, or when nothing is set. */
export function mmLimits(p: MmLimitInput): MmLimits {
  const images = whole("Images per request", p.limitMmImages, 1, MAX_IMAGES);
  const pixels = whole("Max pixels per image", p.maxImagePixels, 1024, MAX_PIXELS);
  const vision = p.baseVision ?? visionFromModelName(p.baseModel);
  if (!vision) return {};
  return { ...(images !== undefined ? { images } : {}), ...(pixels !== undefined ? { pixels } : {}) };
}

/** `KEY=value` env entries for a container, only for the limits that are set. */
export function mmLimitEnv(p: MmLimitInput, prefix: "VLLM" | "SGLANG"): string[] {
  const l = mmLimits(p);
  return [
    ...(l.images !== undefined ? [`${prefix}_LIMIT_MM_IMAGES=${l.images}`] : []),
    ...(l.pixels !== undefined ? [`${prefix}_MAX_IMAGE_PIXELS=${l.pixels}`] : []),
  ];
}
