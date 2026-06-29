import { stopServing } from "@/lib/models-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Stop the inference worker — unload the served model from VRAM (undeploy). */
export async function POST() {
  const ok = await stopServing();
  if (!ok) {
    return Response.json({ ok: false, error: "Transformer Lab menolak permintaan stop" }, { status: 502 });
  }
  return Response.json({ ok: true });
}
