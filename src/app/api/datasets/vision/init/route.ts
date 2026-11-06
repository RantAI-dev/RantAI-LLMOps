import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { destinationFrom, initVisionDataset, visionErrorResponse } from "@/lib/vision-dataset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Step 1 of an image-dataset upload: open an empty dataset. JSON body
 * `{ name, destination?: "workspace" | "s3", bucket?, prefix? }` -> `{ id, ref }`. Refuses a name that is
 * taken (409). Follow with `POST /api/datasets/vision/<id>/files` (images, in batches) and `.../complete`
 * (train.jsonl, eval.jsonl); `DELETE /api/datasets/vision/<id>` cancels. The same `destination`, `bucket`
 * and `prefix` go on every later call as query parameters.
 */
export async function POST(req: NextRequest) {
  const denied = await guardApi(req);
  if (denied) return denied;
  let body: { name?: unknown; destination?: unknown; bucket?: unknown; prefix?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  try {
    const dest = destinationFrom((k) => str(body[k as keyof typeof body]));
    return Response.json(await initVisionDataset({ name: str(body.name) ?? "", destination: dest }));
  } catch (err) {
    return visionErrorResponse(err);
  }
}
