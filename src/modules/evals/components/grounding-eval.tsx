"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FlaskConical, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DEFAULT_GROUNDING_PROMPT,
  type GroundingReport,
  type ScoredCase,
} from "@/lib/grounding-eval";
import { cn } from "@/lib/utils";

type RunResult = {
  model: string;
  report: GroundingReport;
  cases: ScoredCase[];
  errors: string[];
  errorCount: number;
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * One rate. `goodWhen` says which direction is good, because two of these are
 * failures counted upward — a reader should not have to remember which.
 */
function Metric({
  label,
  value,
  goodWhen,
  hint,
}: {
  label: string;
  value: number;
  goodWhen: "high" | "low";
  hint: string;
}) {
  const good = goodWhen === "high" ? value >= 0.8 : value <= 0.2;
  const bad = goodWhen === "high" ? value < 0.5 : value > 0.5;
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
      <div className="mt-1 text-[11px] leading-4 text-ink-faint">{hint}</div>
    </div>
  );
}

function Report({ report }: { report: GroundingReport }) {
  const jenjang = Object.keys(report.byJenjang).sort();
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Menolak dengan benar"
          value={report.refusalAccuracy}
          goodWhen="high"
          hint={`dari ${report.negatives} soal yang jawabannya TIDAK ada di materi`}
        />
        <Metric
          label="Ngarang"
          value={report.hallucinationRate}
          goodWhen="low"
          hint="menjawab padahal materinya tidak mendukung"
        />
        <Metric
          label="Salah tolak"
          value={report.overRefusalRate}
          goodWhen="low"
          hint={`dari ${report.positives} soal yang jawabannya ADA di materi`}
        />
        <Metric
          label="Akurasi sitasi"
          value={report.citationAccuracy}
          goodWhen="high"
          hint="menyebut buku + bab dengan benar"
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
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                    c.hallucinated
                      ? "bg-danger-soft text-danger"
                      : c.modelRefused
                        ? "bg-warning/15 text-warning"
                        : "bg-surface-2 text-ink-soft"
                  )}
                >
                  {c.hallucinated ? "ngarang" : c.modelRefused ? "salah tolak" : "sitasi salah"}
                </span>
                {c.jenjang ? <span className="text-[10px] text-ink-faint">{c.jenjang}</span> : null}
              </div>
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

/**
 * Grounding eval: replay an eval set against a SERVED model and read four rates.
 * Deliberately usable against the base model too — running it once with just the
 * system prompt gives the baseline that says whether a fine-tune was worth it.
 */
export function GroundingEval() {
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [jsonl, setJsonl] = useState("");
  const [systemPrompt, setSystemPrompt] = useState(DEFAULT_GROUNDING_PROMPT);
  // Runtime lever, not a quality one: a grounded answer is a sentence plus its
  // source. Raise it only if replies are visibly getting cut off mid-answer.
  const [maxTokens, setMaxTokens] = useState(192);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/serve/info", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ models?: Array<{ id: string }> }>)
      .then((d) => {
        if (cancelled) return;
        const ids = (d.models ?? []).map((m) => m.id);
        setModels(ids);
        setModel((cur) => cur || ids[0] || "");
      })
      .catch(() => {
        /* leave the picker empty; the user sees the empty-state hint */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const readFile = useCallback((file: File) => {
    file
      .text()
      .then(setJsonl)
      .catch(() => setError("Gagal membaca file"));
  }, []);

  const rows = jsonl.split(/\r?\n/).filter((l) => l.trim()).length;

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/evals/grounding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, jsonl, systemPrompt, maxTokens }),
      });
      const data = (await res.json()) as RunResult & { error?: string };
      if (!res.ok) throw new Error(data.error || `Eval gagal (${res.status})`);
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eval gagal dijalankan");
    } finally {
      setRunning(false);
    }
  };

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
          <strong>model dasar</strong> untuk dapat angka pembanding — itu yang menjawab apakah
          fine-tune benar-benar menambah sesuatu.
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
            Isi eval set <span className="text-ink-soft">(kolom instruction + output, boleh ditempel langsung)</span>
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
            kualitas. Makin besar makin lama — pada model 8B, 512 token bisa berarti ~20 detik per
            soal. Naikkan hanya kalau jawaban terlihat terpotong.
          </span>
        </label>

        {error ? (
          <div className="mt-3 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {error}
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-3">
          <Button type="button" onClick={run} disabled={running || !model || rows === 0}>
            {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {running ? "Menjalankan…" : "Jalankan eval"}
          </Button>
          <p className="text-[12px] text-ink-soft">
            {rows > 0 ? `${rows} soal · perkiraan ${Math.max(1, Math.ceil((rows * 2) / 4 / 60))} menit` : "Pilih atau tempel eval set dulu"}
          </p>
        </div>
      </div>

      {result ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-primary">Hasil</h3>
            <span className="font-mono text-[11px] text-ink-soft">{result.model}</span>
          </div>

          {result.errorCount > 0 ? (
            <div className="mb-3 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-[12px] text-warning">
              {result.errorCount} permintaan gagal dan diskor sebagai jawaban kosong — angka di bawah
              lebih buruk dari yang sebenarnya. Jalankan ulang. ({result.errors[0]})
            </div>
          ) : null}

          <Report report={result.report} />
          <div className="mt-3 border-t border-border pt-3">
            <Failures cases={result.cases} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
