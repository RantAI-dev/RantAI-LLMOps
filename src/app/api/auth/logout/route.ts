import type { NextRequest } from "next/server";

import { AUTH_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Clear the session cookie. */
export async function POST(req: NextRequest) {
  const res = Response.json({ ok: true });
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  const secure = proto === "https" ? "; Secure" : "";
  res.headers.append("Set-Cookie", `${AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax${secure}; Max-Age=0`);
  return res;
}
