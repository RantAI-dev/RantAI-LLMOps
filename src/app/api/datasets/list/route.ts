import { listTlDatasets } from "@/lib/finetune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Real datasets on disk in Transformer Lab (`/data/list`). Powers the Dataset
 * Registry page. Degrades to an empty list (never 500s) when TL is down.
 */
export async function GET() {
  try {
    const datasets = await listTlDatasets();
    return Response.json({ datasets });
  } catch (err) {
    console.error("[api/datasets/list] Transformer Lab unreachable or rejected the request:", err);
    return Response.json({ datasets: [] });
  }
}
