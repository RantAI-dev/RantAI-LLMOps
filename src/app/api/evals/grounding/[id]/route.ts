import { deleteEvalRun, readEvalRun } from "@/lib/eval-run-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One grounding eval run, including its per-row cases. Polled while a run is in
 * flight (the work continues server-side, so this keeps reporting progress even
 * if the page was closed and reopened) and read once more when it finishes.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const run = await readEvalRun(id);
    if (!run) return Response.json({ error: "Run tidak ditemukan" }, { status: 404 });
    return Response.json({ run });
  } catch {
    // readEvalRun throws only on an id that could escape the runs directory.
    return Response.json({ error: "Run id tidak valid" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteEvalRun(id);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Run id tidak valid" }, { status: 400 });
  }
}
