import { fetchTlComputeProviders } from "@/lib/compute-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Real compute providers from Transformer Lab. Degrades to [] on error. */
export async function GET() {
  try {
    return Response.json({ providers: await fetchTlComputeProviders() });
  } catch (err) {
    console.error("[api/compute/providers] Transformer Lab unreachable:", err);
    return Response.json({ providers: [] });
  }
}
