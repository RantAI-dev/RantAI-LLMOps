import { fetchEvalOptions, type EvalOptions } from "@/lib/evals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Models + benchmarks for the Evals form. */
export async function GET() {
  try {
    return Response.json(await fetchEvalOptions());
  } catch (err) {
    console.error("[api/evals/options] Transformer Lab unreachable or rejected the request:", err);
    return Response.json({ models: [], benchmarks: [] } satisfies EvalOptions);
  }
}
