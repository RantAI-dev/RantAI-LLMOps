/**
 * Server-side checks of a vision fine-tune request (POST /api/finetune/submit with method "vision").
 * Pure apart from one injectable `fetch`, so it is unit-tested without the network.
 *
 * The base must be able to see: the trainer loads it with FastVisionModel, and a text-only base would
 * fail minutes into the job's environment setup. `config.json` of the Hugging Face repo is the source of
 * truth (`vision_config`), read through `modelCapabilities` like everywhere else.
 */
import { modelCapabilities } from "@/lib/model-capabilities";

const HF_RESOLVE = "https://huggingface.co";
const FETCH_TIMEOUT_MS = 8000;

export const VISION_BASE_HINT = "aisingapore/Gemma-SEA-LION-v4-4B-VL";

/**
 * Why `baseModel` cannot be used for a vision fine-tune, or null when it can (or cannot be checked).
 * Only a config that was actually read and has no vision signal is a refusal: an unreachable Hub, a gated
 * repo or a local path return null, and the trainer fails loudly on those itself.
 */
export async function visionBaseProblem(
  baseModel: string,
  opts: { token?: string; fetchImpl?: typeof fetch } = {}
): Promise<string | null> {
  const id = baseModel.trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(id) || id.startsWith(".")) return null; // a local path / unknown shape: not checkable here
  const doFetch = opts.fetchImpl ?? fetch;
  let config: unknown;
  try {
    const res = await doFetch(`${HF_RESOLVE}/${id}/resolve/main/config.json`, {
      headers: opts.token ? { Authorization: `Bearer ${opts.token}` } : undefined,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return null;
    config = await res.json();
  } catch {
    return null;
  }
  if (typeof config !== "object" || config === null) return null;
  const architectures = (config as { architectures?: unknown }).architectures;
  const caps = modelCapabilities({
    config,
    architecture: Array.isArray(architectures) ? architectures.filter((a): a is string => typeof a === "string") : undefined,
  });
  if (caps.vision) return null;
  return (
    `"${id}" is not a vision-language model (${caps.reason}), so it cannot be fine-tuned with the Vision method. ` +
    `Pick a VL base such as ${VISION_BASE_HINT}, or use SFT for a text-only model.`
  );
}

type VisionBody = {
  maxPixels?: unknown;
  maxImagesPerSample?: unknown;
  maxTrainRows?: unknown;
  maxEvalRows?: unknown;
  gradientAccumulationSteps?: unknown;
  batchSize?: unknown;
  maxSeqLength?: unknown;
};

/** Range problems of the vision-only knobs (numbers are already coerced by the route). Empty = fine. */
export function visionParamProblems(b: VisionBody): string[] {
  const out: string[] = [];
  const int = (v: unknown, name: string, min: number, max?: number) => {
    if (v === undefined || v === null) return;
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || (max !== undefined && v > max)) {
      out.push(`${name} must be a whole number${max !== undefined ? ` from ${min} to ${max}` : ` of at least ${min}`}`);
    }
  };
  int(b.maxPixels, "maxPixels", 1024);
  int(b.maxImagesPerSample, "maxImagesPerSample", 1, 16);
  int(b.maxTrainRows, "maxTrainRows", 0);
  int(b.maxEvalRows, "maxEvalRows", 0);
  int(b.gradientAccumulationSteps, "gradientAccumulationSteps", 1);
  int(b.batchSize, "batchSize", 1);
  int(b.maxSeqLength, "maxSeqLength", 256);
  return out;
}

/** A dataset reference the vision trainer can read: s3:// prefix, absolute path, a Hugging Face id, or a
 *  workspace dataset name (checked against the server's list by the route). http(s) URLs cannot carry images. */
export function visionDatasetRefProblem(ref: string): string | null {
  const r = ref.trim();
  if (/^https?:\/\//i.test(r)) {
    return "A vision dataset cannot be an http(s) URL (its images would not come with it). Use an s3:// prefix, a Hugging Face dataset id or a dataset uploaded in Datasets.";
  }
  return null;
}
