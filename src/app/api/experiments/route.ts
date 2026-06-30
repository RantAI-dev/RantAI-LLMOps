import type { NextRequest } from "next/server";

import { createTlExperiment } from "@/lib/tasks-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Create an experiment. */
export async function POST(req: NextRequest) {
  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const name = body.name?.trim();
  if (!name) return Response.json({ error: "`name` is required" }, { status: 400 });
  try {
    const id = await createTlExperiment(name);
    return Response.json({ ok: true, id });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Gagal membuat experiment" },
      { status: 502 }
    );
  }
}
