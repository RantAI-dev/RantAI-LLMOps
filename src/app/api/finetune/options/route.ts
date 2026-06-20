import { fetchFinetuneOptions, type FinetuneOptions } from "@/lib/finetune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Trainable base models + datasets for the Fine-tune form. */
export async function GET() {
  try {
    return Response.json(await fetchFinetuneOptions());
  } catch (err) {
    console.error("[api/finetune/options] Transformer Lab unreachable or rejected the request:", err);
    return Response.json({ models: [], datasets: [] } satisfies FinetuneOptions);
  }
}
