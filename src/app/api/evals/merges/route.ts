import { listMerges } from "@/lib/merge-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Adapter merges in flight, so the Evals screen can say what it is waiting on.
 *
 * A fine-tune's merge can run for half an hour before its eval job exists at
 * all. Without this the screen showed "preparing…" with nothing behind it, and
 * a merge that failed looked identical to one still working.
 */
export async function GET() {
  return Response.json({ merges: listMerges() });
}
