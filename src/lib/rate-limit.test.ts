import { describe, expect, it } from "vitest";

import { rateLimit } from "@/lib/rate-limit";

describe("rateLimit", () => {
  it("allows up to `max` hits then blocks within the window", () => {
    const key = "test:allow-then-block";
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(key, { max: 5, windowMs: 60_000 }).ok).toBe(true);
    }
    const blocked = rateLimit(key, { max: 5, windowMs: 60_000 });
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("tracks keys independently", () => {
    expect(rateLimit("test:k1", { max: 1, windowMs: 60_000 }).ok).toBe(true);
    expect(rateLimit("test:k2", { max: 1, windowMs: 60_000 }).ok).toBe(true);
    expect(rateLimit("test:k1", { max: 1, windowMs: 60_000 }).ok).toBe(false);
  });
});
