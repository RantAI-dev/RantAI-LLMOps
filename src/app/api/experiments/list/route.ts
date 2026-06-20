import { listTlExperiments } from "@/lib/tasks-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Real Transformer Lab experiments (`GET /experiment/`). */
export async function GET() {
  try {
    const experiments = await listTlExperiments();
    return Response.json({ experiments });
  } catch (err) {
    console.error("[api/experiments/list] Transformer Lab unreachable or rejected the request:", err);
    return Response.json({ experiments: [] });
  }
}
