import type { NextRequest } from "next/server";

import { deleteDataset } from "@/lib/finetune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Delete a local dataset by id. */
export async function POST(req: NextRequest) {
  let body: { datasetId?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body.datasetId) {
    return Response.json({ error: "`datasetId` is required" }, { status: 400 });
  }
  await deleteDataset(body.datasetId);
  return Response.json({ ok: true });
}
