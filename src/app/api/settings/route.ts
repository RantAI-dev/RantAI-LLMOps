import type { NextRequest } from "next/server";

import { getSettings, setHfToken } from "@/lib/settings-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET: which app settings are configured. Never returns the raw HF token — only
 * whether one is set — so the secret can't be read back out of the browser.
 */
export async function GET() {
  const s = await getSettings();
  return Response.json({ hasHfToken: !!s.hfToken });
}

/** POST `{ hfToken }`: save the token (empty string / null clears it). */
export async function POST(req: NextRequest) {
  let body: { hfToken?: string | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const token = (body.hfToken ?? "").trim();
  await setHfToken(token || null);
  return Response.json({ ok: true, hasHfToken: !!token });
}
