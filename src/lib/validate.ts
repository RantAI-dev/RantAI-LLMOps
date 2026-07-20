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

// One segment of a dataset reference. Dot-directories are ordinary on Linux — the
// Transformer Lab data volume itself lives under `.transformerlab` — so a leading
// dot is allowed; only "." and ".." are refused below, which is how traversal is
// spelled. (An earlier rule required every segment to START alphanumeric, which
// blocked traversal but also every hidden directory.)
const DATASET_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * A dataset may live somewhere MODEL_ID cannot express: a corpus that has to stay
 * on-premise is addressed by path or bucket, not by hub id. Accepts a hub id, a
 * filesystem path, or an s3/http(s) URI. A trailing slash is allowed only on a
 * URI, where it names a prefix holding train.jsonl + eval.jsonl — so an
 * incomplete hub id like "owner/" is still caught at submit time.
 */
export function assertDatasetRef(v: string): void {
  const reject = () => {
    throw new Error(`Invalid dataset ref: ${JSON.stringify(v)}`);
  };
  if (!v) reject();

  let rest = v;
  const scheme = /^(?:s3|https?):\/\//.exec(v);
  if (scheme) rest = v.slice(scheme[0].length);
  else if (rest.startsWith("./")) rest = rest.slice(2);
  else if (rest.startsWith("/")) rest = rest.slice(1);

  if (rest.endsWith("/")) {
    if (!scheme) reject(); // only a URI may name a prefix
    rest = rest.slice(0, -1);
  }

  for (const segment of rest.split("/")) {
    if (!DATASET_SEGMENT.test(segment) || segment === "." || segment === "..") reject();
  }
}
