import type { NextRequest } from "next/server";

import {
  APP_PASSWORD,
  AUTH_COOKIE,
  AUTH_ENABLED,
  AUTH_MAX_AGE,
  constantTimeEqual,
  sessionToken,
} from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Exchange the shared password for a session cookie. */
export async function POST(req: NextRequest) {
  if (!AUTH_ENABLED) return Response.json({ ok: true }); // gate disabled — nothing to do

  // Throttle brute-force guessing. Per-IP is the primary limit; a global cap is a
  // backstop so a spoofed X-Forwarded-For (which we can't trust when not behind a
  // known proxy) can't lift the aggregate rate by spraying fake IPs.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const perIp = rateLimit(`login:${ip}`, { max: 10, windowMs: 5 * 60_000 });
  const global = rateLimit("login:*", { max: 60, windowMs: 5 * 60_000 });
  if (!perIp.ok || !global.ok) {
    const retryAfter = Math.max(perIp.retryAfter, global.retryAfter);
    return Response.json(
      { error: "Terlalu banyak percobaan. Coba lagi nanti." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.password || !constantTimeEqual(body.password, APP_PASSWORD)) {
    return Response.json({ error: "Password salah" }, { status: 401 });
  }
  const res = Response.json({ ok: true });
  res.headers.append(
    "Set-Cookie",
    `${AUTH_COOKIE}=${await sessionToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_MAX_AGE}`
  );
  return res;
}
