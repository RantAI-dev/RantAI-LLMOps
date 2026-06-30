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

  // Throttle brute-force guessing: max 10 attempts per IP per 5 minutes.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const limit = rateLimit(`login:${ip}`, { max: 10, windowMs: 5 * 60_000 });
  if (!limit.ok) {
    return Response.json(
      { error: "Terlalu banyak percobaan. Coba lagi nanti." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
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
