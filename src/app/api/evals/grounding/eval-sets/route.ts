import { getEvalSetText, listEvalSets, s3Configured, EVAL_SET_BUCKET } from "@/lib/s3";
import { logServerError } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Grounding eval sets stored in S3 / MinIO.
 *
 * GET (no `key`)  → list the `.jsonl` eval sets in a bucket, so the UI can offer
 *                   them instead of a manual upload.
 * GET (with `key`)→ read that eval set's JSONL text, which the UI feeds into the
 *                   existing grounding run (same shape as a pasted/uploaded set).
 *
 * `bucket` defaults to EVAL_SET_BUCKET; a team can browse another (e.g. `sft`)
 * without a rebuild.
 */
export async function GET(req: Request) {
  if (!s3Configured()) {
    return Response.json(
      { configured: false, error: "S3/MinIO belum dikonfigurasi (S3_ENDPOINT_URL / kredensial belum diset).", evalSets: [] },
      { status: 200 }
    );
  }
  const url = new URL(req.url);
  const bucket = url.searchParams.get("bucket") || EVAL_SET_BUCKET;
  const key = url.searchParams.get("key");

  try {
    if (key) {
      // Content of one eval set. Keep it modest — the grounding run holds it in memory.
      const jsonl = await getEvalSetText(key, bucket);
      if (jsonl.length > 20 * 1024 * 1024) {
        return Response.json({ error: "Eval set terlalu besar (>20 MB)." }, { status: 413 });
      }
      return Response.json({ jsonl });
    }
    const prefix = url.searchParams.get("prefix") || "";
    return Response.json({ configured: true, bucket, evalSets: await listEvalSets(bucket, prefix) });
  } catch (err) {
    logServerError("grounding/eval-sets", err);
    return Response.json(
      { configured: true, error: err instanceof Error ? err.message : "Gagal mengakses S3", evalSets: [] },
      { status: 502 }
    );
  }
}
