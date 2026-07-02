/**
 * Build a detail-page URL whose id may contain "/" or other special characters
 * (e.g. a Hugging Face repo id "owner/name", or an Ollama model tag "qwen:0.5b").
 *
 * Each "/"-delimited segment is percent-encoded, then joined back with "/" so a
 * catch-all `[...id]` route can reassemble the original id via `params.id.join("/")`.
 */
export function detailHref(base: string, id: string): string {
  const path = id
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `${base}/${path}`;
}
