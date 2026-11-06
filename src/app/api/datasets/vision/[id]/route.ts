import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { abortVisionDataset, destinationFrom, visionErrorResponse } from "@/lib/vision-dataset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Cancel an upload that has not completed: deletes what was stored so far. Only works on a dataset opened by
 * `init` and not yet completed (a finished dataset is deleted from the Datasets page). Query: `destination`,
 * `bucket`, `prefix` as given to `init`.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { id } = await params;
  try {
    await abortVisionDataset({ id, destination: destinationFrom((k) => req.nextUrl.searchParams.get(k)) });
    return Response.json({ ok: true });
  } catch (err) {
    return visionErrorResponse(err);
  }
}
