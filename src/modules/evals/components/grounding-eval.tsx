"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FlaskConical, Loader2, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatInterval, wilsonInterval } from "@/lib/eval-stats";
import type { EvalRun, EvalRunSummary } from "@/lib/eval-run-store";
import {
  DEFAULT_GROUNDING_PROMPT,
  type GroundingReport,
  type ScoredCase,
} from "@/lib/grounding-eval";
import { cn } from "@/lib/utils";

const pct = (n: number) => `${Math.round(n * 100)}%`;

const STATUS_LABEL: Record<EvalRun["status"], string> = {
  running: "berjalan",
  done: "selesai",
  error: "gagal",
  interrupted: "terputus",
};

/**
 * One rate. `goodWhen` says which direction is good, because two of these are
 * failures counted upward — a reader should not have to remember which.
 *
 * `n` is the denominator the rate was computed over. It drives the bar and the
 * confidence range, and it is the difference between "we refuse correctly, full
 * stop" and "10 out of 10, so at least 72% — ask again with a bigger set".
 */
function Metric({
  label,
  value,
  goodWhen,
  hint,
  n,
}: {
  label: string;
  value: number;
  goodWhen: "high" | "low";
  hint: string;
  n?: number;
}) {
  const good = goodWhen === "high" ? value >= 0.8 : value <= 0.2;
  const bad = goodWhen === "high" ? value < 0.5 : value > 0.5;
  const range =
    n != null && n > 0 ? formatInterval(wilsonInterval(Math.round(value * n), n)) : null;
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="text-[11px] font-medium text-ink-soft">{label}</div>
      <div
        className={cn(
          "mt-0.5 text-xl font-semibold tabular-nums",
          good ? "text-success" : bad ? "text-danger" : "text-ink"
        )}
      >
        {pct(value)}
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn(
            "h-full rounded-full",
            good ? "bg-success" : bad ? "bg-danger" : "bg-primary"
          )}
          style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
        />
      </div>
      <div className="mt-1 text-[11px] leading-4 text-ink-faint">{hint}</div>
      {range ? (
        <div className="mt-0.5 text-[11px] leading-4 text-ink-faint" title="Selang kepercayaan 95%">
          Dari {n} kasus, yang bisa diklaim: {range}
        </div>
      ) : null}
    </div>
  );
}

function Report({ report }: { report: GroundingReport }) {
  const jenjang = Object.keys(report.byJenjang).sort();
  // Citation is scored only over positives the model actually answered — the
  // same denominator buildReport uses, so the interval matches the rate.
  const answeredPositives = Math.round(report.positives * (1 - report.overRefusalRate));
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Menolak dengan benar"
          value={report.refusalAccuracy}
          goodWhen="high"
          hint={`dari ${report.negatives} soal yang jawabannya TIDAK ada di materi`}
          n={report.negatives}
        />
        <Metric
          label="Ngarang"
          value={report.hallucinationRate}
          goodWhen="low"
          hint="menjawab padahal materinya tidak mendukung"
          n={report.negatives}
        />
        <Metric
          label="Salah tolak"
          value={report.overRefusalRate}
          goodWhen="low"
          hint={`dari ${report.positives} soal yang jawabannya ADA di materi`}
          n={report.positives}
        />
        <Metric
          label="Akurasi sitasi"
          value={report.citationAccuracy}
          goodWhen="high"
          hint={`dari ${answeredPositives} jawaban yang benar-benar diberikan`}
          n={answeredPositives}
        />
      </div>

      {jenjang.length > 0 ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[12px]">
            <thead className="bg-surface-2 text-ink-soft">
              <tr>
                {["Jenjang", "Soal", "Menolak benar", "Ngarang", "Salah tolak", "Sitasi"].map((h) => (
                  <th key={h} className="px-3 py-1.5 text-left font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {jenjang.map((j) => {
                const r = report.byJenjang[j];
                return (
                  <tr key={j} className="border-t border-border">
                    <td className="px-3 py-1.5 font-medium text-ink">{j}</td>
                    <td className="px-3 py-1.5 tabular-nums text-ink-soft">{r.total}</td>
                    <td className="px-3 py-1.5 tabular-nums">{pct(r.refusalAccuracy)}</td>
                    <td className="px-3 py-1.5 tabular-nums">{pct(r.hallucinationRate)}</td>
                    <td className="px-3 py-1.5 tabular-nums">{pct(r.overRefusalRate)}</td>
                    <td className="px-3 py-1.5 tabular-nums">{pct(r.citationAccuracy)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** The rows worth reading: a number is only actionable if you can see what went
 *  wrong behind it. */
function Failures({ cases }: { cases: ScoredCase[] }) {
  const [open, setOpen] = useState(false);
  const failed = cases.filter(
    (c) => c.hallucinated || (!c.isNegative && (c.modelRefused || !c.citationOk))
  );
  if (failed.length === 0) {
    return <p className="text-[12px] text-success">Tidak ada kasus gagal — semua soal lolos.</p>;
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[12px] font-medium text-ink-soft hover:text-ink"
      >
        {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
        {failed.length} kasus gagal — lihat detail
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          {failed.map((c, i) => (
            <div key={i} className="rounded-lg border border-border bg-background p-2.5 text-[12px]">
              {/* "no citation" and "wrong answer" both land here, and they are very
                  different problems — a right answer missing its source is a format
                  gap, a wrong one is a grounding failure. The overlap tells them apart. */}
              {(() => {
                const contentOk = c.contentOverlap >= 0.5;
                const label = c.hallucinated
                  ? "ngarang"
                  : c.modelRefused
                    ? "salah tolak"
                    : contentOk
                      ? "sitasi hilang · isi cocok"
                      : // Not "wrong": word overlap cannot judge correctness, and a
                        // right answer phrased differently ("F = m × a") lands here.
                        "isi beda · cek manual";
                const tone = c.hallucinated
                  ? "bg-danger-soft text-danger"
                  : c.modelRefused
                    ? "bg-warning/15 text-warning"
                    : contentOk
                      ? "bg-surface-2 text-ink-soft"
                      : "bg-danger-soft text-danger";
                return (
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", tone)}>
                      {label}
                    </span>
                    {c.jenjang ? <span className="text-[10px] text-ink-faint">{c.jenjang}</span> : null}
                    {!c.isNegative && !c.modelRefused ? (
                      <span className="text-[10px] text-ink-faint">
                        kemiripan isi {Math.round(c.contentOverlap * 100)}%
                      </span>
                    ) : null}
                  </div>
                );
              })()}
              <p className="text-ink-soft">
                <span className="font-medium text-ink">Pertanyaan:</span>{" "}
                {c.instruction.split("Pertanyaan siswa:").pop()?.trim().slice(0, 200)}
              </p>
              <p className="mt-1 text-ink-soft">
                <span className="font-medium text-ink">Seharusnya:</span> {c.expected.slice(0, 200)}
              </p>
              <p className="mt-1 text-ink-soft">
                <span className="font-medium text-ink">Jawaban model:</span>{" "}
                {c.actual.trim().slice(0, 300) || <em>(kosong)</em>}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Past runs. The reason this exists: comparing a baseline against a fine-tune is
 *  the point of running an eval twice, and doing that from two screenshots is
 *  needlessly hard. */
function History({
  runs,
  activeId,
  onOpen,
  onDelete,
}: {
  runs: EvalRunSummary[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (runs.length === 0) return null;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="mb-2 text-sm font-semibold text-primary">Riwayat run</h3>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[12px]">
          <thead className="bg-surface-2 text-ink-soft">
            <tr>
              {["Waktu", "Model", "Status", "Ngarang", "Menolak benar", "Sitasi", ""].map((h) => (
                <th key={h} className="px-3 py-1.5 text-left font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr
                key={r.id}
                onClick={() => onOpen(r.id)}
                className={cn(
                  "cursor-pointer border-t border-border hover:bg-surface-2",
                  r.id === activeId && "bg-primary-soft/40"
                )}
              >
                <td className="px-3 py-1.5 whitespace-nowrap text-ink-soft">
                  {new Date(r.createdAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}
                </td>
                <td className="max-w-[18rem] truncate px-3 py-1.5 font-mono text-[11px] text-ink">{r.model}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-medium",
                      r.status === "done"
                        ? "bg-success-soft text-success"
                        : r.status === "running"
                          ? "bg-primary-soft text-primary"
                          : "bg-danger-soft text-danger"
                    )}
                  >
                    {STATUS_LABEL[r.status]}
                    {r.status === "running" ? ` ${r.completed}/${r.total}` : ""}
                  </span>
                </td>
                <td className="px-3 py-1.5 tabular-nums">{r.report ? pct(r.report.hallucinationRate) : "—"}</td>
                <td className="px-3 py-1.5 tabular-nums">{r.report ? pct(r.report.refusalAccuracy) : "—"}</td>
                <td className="px-3 py-1.5 tabular-nums">{r.report ? pct(r.report.citationAccuracy) : "—"}</td>
                <td className="px-3 py-1.5">
                  <button
                    type="button"
                    aria-label="Hapus run"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(r.id);
                    }}
                    className="rounded p-1 text-ink-soft hover:bg-danger-soft hover:text-danger"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Grounding eval: replay an eval set against a SERVED model and read four rates.
 * Runs are started server-side, so leaving the page does not abandon them — the
 * page reattaches to whatever is still running when it loads.
 */
export function GroundingEval() {
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [jsonl, setJsonl] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_GROUNDING_PROMPT);
  // Runtime lever, not a quality one: a grounded answer is a sentence plus its
  // source. Raise it only if replies are visibly getting cut off mid-answer.
  const [maxTokens, setMaxTokens] = useState(192);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [runs, setRuns] = useState<EvalRunSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<EvalRun | null>(null);
  // Only auto-attach to an in-flight run once, or reopening a finished run would
  // keep getting yanked back to it.
  const attached = useRef(false);

  const loadRuns = useCallback(async () => {
    try {
      const d = (await (await fetch("/api/evals/grounding", { cache: "no-store" })).json()) as {
        runs?: EvalRunSummary[];
      };
      const list = d.runs ?? [];
      setRuns(list);
      if (!attached.current) {
        attached.current = true;
        const inFlight = list.find((r) => r.status === "running");
        if (inFlight) setActiveId(inFlight.id);
      }
    } catch {
      /* keep whatever is on screen */
    }
  }, []);

  useEffect(() => {
    fetch("/api/serve/info", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ models?: Array<{ id: string }> }>)
      .then((d) => {
        const ids = (d.models ?? []).map((m) => m.id);
        setModels(ids);
        setModel((cur) => cur || ids[0] || "");
      })
      .catch(() => {
        /* the picker shows its empty-state hint */
      });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot load on mount; state is only set once the request resolves, and this is what reattaches the page to a run still in flight
    void loadRuns();
  }, [loadRuns]);

  // Follow the selected run: poll while it is still working, then stop.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const d = (await (await fetch(`/api/evals/grounding/${activeId}`, { cache: "no-store" })).json()) as {
          run?: EvalRun;
        };
        if (cancelled || !d.run) return;
        setActive(d.run);
        if (d.run.status === "running") {
          timer = setTimeout(tick, 2000);
        } else {
          void loadRuns(); // final numbers belong in the history table too
        }
      } catch {
        if (!cancelled) timer = setTimeout(tick, 4000);
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeId, loadRuns]);

  const readFile = useCallback((file: File) => {
    file
      .text()
      .then(setJsonl)
      .catch(() => setError("Gagal membaca file"));
  }, []);

  const rows = jsonl.split(/\r?\n/).filter((l) => l.trim()).length;

  const start = async () => {
    setStarting(true);
    setError(null);
    setActive(null);
    try {
      const res = await fetch("/api/evals/grounding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, jsonl, systemPrompt, maxTokens }),
      });
      const data = (await res.json()) as { runId?: string; error?: string };
      if (!res.ok || !data.runId) throw new Error(data.error || `Eval gagal dimulai (${res.status})`);
      setActiveId(data.runId);
      void loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eval gagal dimulai");
    } finally {
      setStarting(false);
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/evals/grounding/${id}`, { method: "DELETE" }).catch(() => {});
    if (id === activeId) {
      setActiveId(null);
      setActive(null);
    }
    void loadRuns();
  };

  const running = active?.status === "running";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-1 flex items-center gap-2">
          <FlaskConical className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold text-primary">Grounding eval</h2>
        </div>
        <p className="mb-3 text-[12px] leading-4 text-ink-soft">
          Uji apakah model menjawab <strong>hanya dari materi</strong> yang diberikan: menolak saat
          jawabannya tidak ada, dan menyebut sumbernya saat ada. Jalankan juga pada{" "}
          <strong>model dasar</strong> untuk dapat angka pembanding. Eval berjalan di server —{" "}
          <strong>boleh ditinggal pindah halaman</strong>.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">Model (yang disajikan)</span>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
            >
              {models.length === 0 ? <option value="">Belum ada model di Ollama</option> : null}
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">
              Eval set (JSONL) {rows > 0 ? <span className="text-ink-soft">· {rows} baris</span> : null}
            </span>
            <span className="inline-flex h-9 w-full cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-2 text-[13px] text-ink-soft hover:bg-surface-2">
              <Upload className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">Pilih file eval.jsonl…</span>
              <input
                type="file"
                accept=".jsonl,.json,.txt"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) readFile(f);
                }}
              />
            </span>
          </label>
        </div>

        <label className="mt-3 block">
          <span className="mb-1 block text-[13px] font-medium text-ink">
            Isi eval set{" "}
            <span className="text-ink-soft">(kolom instruction + output, boleh ditempel langsung)</span>
          </span>
          <textarea
            value={jsonl}
            onChange={(e) => setJsonl(e.target.value)}
            rows={4}
            spellCheck={false}
            placeholder='{"instruction":"[Buku IPA Kelas 3, Bab 2: ...]\n...\n\nPertanyaan siswa: ...","output":"..."}'
            className="w-full rounded-md border border-input bg-background p-2 font-mono text-[11px] leading-4 outline-none focus:border-primary"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-[13px] font-medium text-ink">System prompt</span>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={5}
            spellCheck={false}
            className="w-full rounded-md border border-input bg-background p-2 font-mono text-[11px] leading-4 outline-none focus:border-primary"
          />
          <span className="mt-1 block text-[11px] text-ink-soft">
            Kosongkan untuk menguji model <strong>tanpa</strong> prompt sama sekali — bedanya dengan
            hasil di atas menunjukkan seberapa besar andil prompt.
          </span>
        </label>

        <label className="mt-3 block max-w-[16rem]">
          <span className="mb-1 block text-[13px] font-medium text-ink">Batas token jawaban</span>
          <input
            type="number"
            min={32}
            step={32}
            value={maxTokens}
            onChange={(e) => setMaxTokens(Number(e.target.value))}
            onBlur={() => setMaxTokens((v) => (Number.isFinite(v) && v >= 32 ? v : 192))}
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
          />
          <span className="mt-1 block text-[11px] leading-4 text-ink-soft">
            Jawaban grounding cuma 1-2 kalimat, jadi ini pengatur <strong>durasi</strong>, bukan
            kualitas. Naikkan hanya kalau jawaban terlihat terpotong.
          </span>
        </label>

        {error ? (
          <div className="mt-3 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-3">
          <Button type="button" onClick={start} disabled={starting || running || !model || rows === 0}>
            {starting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {running ? "Sedang berjalan…" : starting ? "Memulai…" : "Jalankan eval"}
          </Button>
          <p className="text-[12px] text-ink-soft">
            {rows > 0 ? `${rows} soal` : "Pilih atau tempel eval set dulu"}
          </p>
        </div>
      </div>

      {active ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-primary">
              {running ? "Sedang berjalan" : "Hasil"}
            </h3>
            <span className="font-mono text-[11px] text-ink-soft">{active.model}</span>
          </div>

          {running ? (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-[12px] text-ink-soft">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {active.completed} / {active.total} soal — boleh ditinggal, hasilnya tetap tersimpan.
              </div>
              <div className="h-1.5 overflow-hidden rounded bg-surface-2">
                <div
                  className="h-full bg-primary transition-[width] duration-500"
                  style={{ width: `${Math.round((active.completed / Math.max(1, active.total)) * 100)}%` }}
                />
              </div>
            </div>
          ) : null}

          {active.status === "interrupted" || active.status === "error" ? (
            <div className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[12px] text-danger">
              {active.error ?? "Run gagal."}
            </div>
          ) : null}

          {active.errorCount > 0 ? (
            <div className="mb-3 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-[12px] text-warning">
              {active.errorCount} permintaan gagal dan diskor sebagai jawaban kosong — angka di bawah
              lebih buruk dari yang sebenarnya. Jalankan ulang. ({active.errorSample})
            </div>
          ) : null}

          {active.report ? (
            <>
              <Report report={active.report} />
              {active.cases ? (
                <div className="mt-3 border-t border-border pt-3">
                  <Failures cases={active.cases} />
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <History runs={runs} activeId={activeId} onOpen={setActiveId} onDelete={remove} />
    </div>
  );
}
