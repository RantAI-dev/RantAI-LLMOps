/**
 * Minimal in-memory sliding-window rate limiter.
 *
 * Suited to this app's deployment model: a single long-lived Next server
 * (self-host, local-first). It is intentionally process-local — it does not
 * survive a restart and does not coordinate across replicas, which is fine for
 * a shared-password gate whose only job is to blunt brute-force guessing.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  ok: boolean;
  /** Seconds until the window resets (only meaningful when `ok` is false). */
  retryAfter: number;
};

/**
 * Record one hit against `key`. Allows up to `max` hits per `windowMs`.
 * Returns `{ ok: false }` once the limit is exceeded within the window.
 */
export function rateLimit(
  key: string,
  { max, windowMs }: { max: number; windowMs: number }
): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  bucket.count += 1;
  if (bucket.count > max) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { ok: true, retryAfter: 0 };
}
