import { deleteEvalRun, readEvalRun, saveEvalRun } from "@/lib/eval-run-store";
import { buildReport, rescoreCase } from "@/lib/grounding-eval";
import { logServerError } from "@/lib/log";

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

/**
 * Recompute a finished run's report from its stored replies using the current
 * scoring rules — no model calls. Fixes a stale report after the scoring logic
 * improved (e.g. the citation fix), without re-running the whole eval.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let run;
  try {
    run = await readEvalRun(id);
  } catch {
    return Response.json({ error: "Run id tidak valid" }, { status: 400 });
  }
  if (!run) return Response.json({ error: "Run tidak ditemukan" }, { status: 404 });
  if (!run.cases?.length) {
    return Response.json(
      { error: "Run ini tidak menyimpan jawaban per-baris, jadi tidak bisa dihitung ulang. Jalankan ulang eval." },
      { status: 400 }
    );
  }
  try {
    const cases = run.cases.map(rescoreCase);
    const updated = { ...run, cases, report: buildReport(cases) };
    await saveEvalRun(updated);
    return Response.json({ run: updated });
  } catch (err) {
    logServerError("evals/grounding recompute", err);
    return Response.json({ error: "Gagal menghitung ulang skor" }, { status: 500 });
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
