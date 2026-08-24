/**
 * Pipeline caching + versioning helpers (Flyte-inspired).
 *
 * Client-safe on purpose: no `node:crypto` and no `window.crypto.subtle`
 * (subtle is unavailable on the plain-http origins this app is served from), so
 * the hash is a small pure-JS function that runs identically in the browser and
 * on the server.
 */

/**
 * Bump when the trainer/export logic changes in a way that would make a prior
 * cached adapter WRONG to reuse. Runs recorded under an older CACHE_VERSION stop
 * matching, so an identical config re-trains instead of reusing a stale artifact.
 */
export const CACHE_VERSION = 1;

/** The inputs that actually decide the trained adapter (the cache key). */
export type CacheableConfig = {
  baseModel: string;
  baseModelArchitecture?: string;
  dataset: string;
  adaptorName: string;
  epochs: number;
};

/**
 * cyrb53 — a compact, well-distributed non-crypto hash. More than enough to dedupe
 * a few dozen pipeline runs by content; we're skipping identical re-runs, not
 * defending against adversarial collisions.
 */
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Deterministic content hash of the training inputs. Same inputs + same
 * CACHE_VERSION → same hash → the prior adapter can be reused. The field order is
 * fixed and each value is labelled so two configs can't collide by concatenation.
 */
export function computeConfigHash(cfg: CacheableConfig): string {
  const canonical = JSON.stringify([
    "v",
    CACHE_VERSION,
    "base",
    cfg.baseModel,
    "arch",
    cfg.baseModelArchitecture ?? "",
    "data",
    cfg.dataset,
    "name",
    cfg.adaptorName,
    "epochs",
    cfg.epochs,
  ]);
  return cyrb53(canonical).toString(16).padStart(14, "0");
}
