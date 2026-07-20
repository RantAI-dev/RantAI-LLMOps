import { fetchEvalSamples } from "@/lib/evals";
import { assertJobId } from "@/lib/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The per-question results behind one benchmark score.
 *
 * Fetched on demand rather than folded into `/api/evals/jobs`: a run holds
 * hundreds of rows and the list renders many jobs, so this only loads for the
 * one job whose breakdown someone opened.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    assertJobId(id);
  } catch {
    return Response.json({ error: "Job id tidak valid" }, { status: 400 });
  }
  return Response.json({ samples: await fetchEvalSamples(id) });
}
