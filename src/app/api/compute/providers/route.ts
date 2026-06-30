import type { NextRequest } from "next/server";

import { createTlComputeProvider, fetchTlComputeProviders } from "@/lib/compute-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Real compute providers from Transformer Lab. Degrades to [] on error. */
export async function GET() {
  try {
    return Response.json({ providers: await fetchTlComputeProviders() });
  } catch (err) {
    console.error("[api/compute/providers] Transformer Lab unreachable:", err);
    return Response.json({ providers: [] });
  }
}

/** Create a compute provider. */
export async function POST(req: NextRequest) {
  let body: { name?: string; type?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.name || !body.type) {
    return Response.json({ error: "`name` and `type` are required" }, { status: 400 });
  }
  const ok = await createTlComputeProvider(body.name, body.type);
  return ok
    ? Response.json({ ok: true })
    : Response.json({ error: "Gagal membuat provider" }, { status: 502 });
}
