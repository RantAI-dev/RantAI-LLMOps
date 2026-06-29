import type { NextRequest } from "next/server";

import { APP_PASSWORD, AUTH_COOKIE, AUTH_ENABLED, AUTH_MAX_AGE, sessionToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Exchange the shared password for a session cookie. */
export async function POST(req: NextRequest) {
  if (!AUTH_ENABLED) return Response.json({ ok: true }); // gate disabled — nothing to do
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.password || body.password !== APP_PASSWORD) {
    return Response.json({ error: "Password salah" }, { status: 401 });
  }
  const res = Response.json({ ok: true });
  res.headers.append(
    "Set-Cookie",
    `${AUTH_COOKIE}=${await sessionToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${AUTH_MAX_AGE}`
  );
  return res;
}
