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

// A dataset may live somewhere MODEL_ID cannot express: a corpus that has to stay
// on-premise is addressed by path or bucket, not by hub id. Two shapes are allowed
// — a hub id / filesystem path (no trailing slash, so "owner/" is still caught at
// submit time), and an s3/http(s) URI (trailing slash allowed: it names a prefix
// holding train.jsonl + eval.jsonl). Every segment must start alphanumeric, so
// ".." can never be a segment; traversal is rejected by construction.
const DATASET_PATH = /^(?:\.\/|\/)?[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const DATASET_URI = /^(?:s3|https?):\/\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*\/?$/;

export function assertDatasetRef(v: string): void {
  const ok = !v.includes("..") && (DATASET_PATH.test(v) || DATASET_URI.test(v));
  if (!ok) throw new Error(`Invalid dataset ref: ${JSON.stringify(v)}`);
}
