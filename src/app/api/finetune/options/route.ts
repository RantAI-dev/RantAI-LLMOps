import { fetchFinetuneOptions, type FinetuneOptions } from "@/lib/finetune";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Trainable base models + datasets for the Fine-tune form. */
export async function GET() {
  try {
    return Response.json(await fetchFinetuneOptions());
  } catch {
    return Response.json({ models: [], datasets: [] } satisfies FinetuneOptions);
  }
}
