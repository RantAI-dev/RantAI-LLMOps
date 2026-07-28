import { s3Config } from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where the "New dataset" form may save to. Returns whether S3 is configured,
 * the allowed buckets, and a sensible default — so the UI can offer an editable
 * S3 destination instead of hard-coding one project's path.
 */
export async function GET() {
  return Response.json({ ...s3Config(), defaultPrefix: "datasets" });
}
