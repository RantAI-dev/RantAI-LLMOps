import type { NextRequest } from "next/server";

import { guardApi } from "@/lib/auth";
import { VISION_JSONL_MAX_BYTES } from "@/lib/vision-limits";
import { completeVisionDataset, destinationFrom, visionErrorResponse } from "@/lib/vision-dataset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Step 3: finish. Multipart form with `train` (train.jsonl, required), `eval` (eval.jsonl, optional) and `name`.
 * Every row is validated AGAIN here against the images that were really stored; if the dataset is not usable
 * it is deleted and this answers 400 with the first problems. On success: `{ id, ref, kind: "vision", report,
 * eval?, images }` where `ref` is what to pick in Fine-tune. Query: `destination`, `bucket`, `prefix`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardApi(req);
  if (denied) return denied;
  const { id } = await params;
  if (Number(req.headers.get("content-length") ?? 0) > 2 * VISION_JSONL_MAX_BYTES + 1024 * 1024) {
    return Response.json({ error: "train.jsonl / eval.jsonl are too large" }, { status: 413 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Body must be multipart/form-data" }, { status: 400 });
  }
  const train = form.get("train");
  if (!(train instanceof File) || train.size === 0) return Response.json({ error: "`train` (train.jsonl) is required" }, { status: 400 });
  const evalFile = form.get("eval");
  try {
    const dest = destinationFrom((k) => req.nextUrl.searchParams.get(k));
    return Response.json(
      await completeVisionDataset({
        id,
        name: String(form.get("name") ?? ""),
        destination: dest,
        train: await train.text(),
        eval: evalFile instanceof File && evalFile.size > 0 ? await evalFile.text() : undefined,
      })
    );
  } catch (err) {
    return visionErrorResponse(err);
  }
}
