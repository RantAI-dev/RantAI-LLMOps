/**
 * Upload size limits, in one place because they must agree in TWO layers.
 *
 * `src/proxy.ts` runs on `/api/*`, and Next buffers a proxied request body in
 * memory so both the proxy and the route can read it — capped by
 * `experimental.proxyClientMaxBodySize` (default 10 MB). Over that cap Next does
 * NOT fail the request: it silently truncates the body and lets it through, so
 * an over-large upload surfaces as "Body must be multipart/form-data" from the
 * route rather than as a size error. Keeping the two limits equal is what makes
 * the route's own 413 the thing users actually hit.
 *
 * This file must stay dependency-free: `next.config.ts` imports it.
 */

/**
 * Largest PDF the corpus pre-processor accepts. Comfortably above a school
 * textbook (the samples in `example-books/` are 8 MB and 35 MB) and bounded,
 * because a book of this size costs several times its own size in RAM while
 * parsing — the proxy buffer, the route's copy, and pdfjs' page structures.
 */
export const MAX_PDF_UPLOAD_BYTES = 64 * 1024 * 1024;

/** The same limit in the string form `proxyClientMaxBodySize` expects. */
export const MAX_PDF_UPLOAD_SIZE = "64mb";
