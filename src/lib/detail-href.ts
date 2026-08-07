/**
 * Build a detail-page URL whose id may contain "/" or other special characters
 * (e.g. a Hugging Face repo id "owner/name", an Ollama tag "qwen:0.5b", or an
 * s3:// reference "s3://bucket/key" — including a folder ref "s3://bucket/").
 *
 * The id is encoded as a SINGLE, slash-free path segment (base64url). Encoding
 * per-"/"-segment (the old scheme) corrupted any id containing "//" or a trailing
 * "/": those became EMPTY path segments, which the router collapses — so
 * "s3://bucket/" round-tripped to "s3:/bucket" and the detail page couldn't match
 * it. base64url sidesteps path parsing entirely; the catch-all `[...id]` route's
 * `params.id.join("/")` yields the one segment, which `decodeDetailId` reverses.
 */
export function detailHref(base: string, id: string): string {
  return `${base}/${encodeDetailId(id)}`;
}

/** Encode an id to a single URL-safe (base64url) path segment. */
export function encodeDetailId(id: string): string {
  const bytes = new TextEncoder().encode(id);
  const b64 =
    typeof btoa === "function"
      ? btoa(String.fromCharCode(...bytes))
      : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Reverse `encodeDetailId`. Falls back to returning the input unchanged if it
 * isn't valid base64url (e.g. a hand-typed or legacy plain id), so old links
 * still resolve when they happen to be a bare id.
 */
export function decodeDetailId(segment: string): string {
  const seg = segment.trim();
  if (!seg || !/^[A-Za-z0-9\-_]+$/.test(seg)) return seg;
  try {
    const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
    const bin =
      typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return seg;
  }
}
