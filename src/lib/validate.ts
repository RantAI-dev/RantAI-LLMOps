/**
 * Per-field validators for values that flow into host scripts or TL paths.
 * These are defense-in-depth (the host runner already isolates args via argv),
 * but validating at the *edge* (submit time) turns a confusing late failure into
 * a clear early one, and blocks path-traversal-shaped ids.
 */

// HF repo id ("owner/name") or a bare model name. No leading '-' (flag-like),
// no '/' beyond the single owner separator, no '..'.
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)?$/;
// Lowercase-ish slug used for Ollama tags / merged dir names.
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
// Job id: numeric or UUID — alphanumeric + dash only (blocks '/', '.', traversal).
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

export function assertJobId(v: string): void {
  if (!JOB_ID.test(v)) throw new Error(`Invalid job id: ${JSON.stringify(v)}`);
}

export function assertModelId(v: string): void {
  if (!MODEL_ID.test(v)) throw new Error(`Invalid model id: ${JSON.stringify(v)}`);
}

export function assertTag(v: string): void {
  if (!SLUG.test(v)) throw new Error(`Invalid tag: ${JSON.stringify(v)}`);
}
