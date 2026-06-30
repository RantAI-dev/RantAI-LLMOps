import type { NextRequest } from "next/server";

import { deleteTlComputeProvider } from "@/lib/compute-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Delete a compute provider. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteTlComputeProvider(id);
  return ok
    ? Response.json({ ok: true })
    : Response.json({ error: "Gagal menghapus provider" }, { status: 502 });
}
