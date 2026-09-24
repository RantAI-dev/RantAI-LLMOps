import { listTlDatasets } from "@/lib/finetune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Real datasets on disk in the backend (`/data/list`). Powers the Dataset
 * Registry page.
 *
 * An unreachable backend answers 502, NOT an empty list: "no datasets" and
 * "could not ask" look identical to a reader and only one of them is true.
 */
export async function GET() {
  try {
    const datasets = await listTlDatasets();
    return Response.json({ datasets });
  } catch (err) {
    console.error("[api/datasets/list] backend unreachable or rejected the request:", err);
    return Response.json(
      { error: "The backend is unreachable, so the dataset list could not be loaded." },
      { status: 502 }
    );
  }
}
