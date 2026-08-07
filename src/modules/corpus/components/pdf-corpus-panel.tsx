"use client";

import { CloudUpload, FileText, Loader2, ScanText, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InfoTip } from "@/components/ui/tooltip";
import { corpusKeys, JENJANG, KELAS_BY_JENJANG } from "@/lib/pdf-corpus";
import { CorpusReport } from "@/modules/corpus/components/corpus-report";
import { usePdfCorpus } from "@/modules/corpus/hooks/use-pdf-corpus";
import { fieldClassName, filterSelectClassName } from "@/modules/datasets/constants/dataset-ui";
import { textUi } from "@/lib/text-ui";

/**
 * Pre-process a school-book PDF into citation-headed chunks — Fase 1 of the
 * corpus plan, driven from the UI. Two steps on purpose: **Analyze** is a dry
 * run that writes nothing, so the detected chapters and a chunk sample can be
 * eyeballed (langkah 1.6) BEFORE anything lands in the corpus bucket.
 */
export function PdfCorpusPanel() {
  const {
    file,
    chooseFile,
    form,
    patch,
    result,
    busy,
    error,
    s3,
    bucket,
    setBucket,
    prefix,
    setPrefix,
    analyze,
    save,
  } = usePdfCorpus();

  const canAnalyze = Boolean(file && form.title.trim() && !busy);
  const canSave = Boolean(result && !result.saved && s3?.configured && bucket.trim() && !busy);

  const previewKeys = form.title.trim()
    ? corpusKeys("<book-id>", { ...form }, prefix)
    : null;

  const handleSave = async () => {
    const saved = await save();
    if (saved?.saved) {
      toast.success(`Saved ${saved.catalog.stats.chunkCount} chunks to ${bucket}.`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-hairline bg-surface p-4">
        <div className="flex items-center gap-1.5">
          <h2 className={`${textUi.section} flex items-center gap-2 text-primary`}>
            <ScanText className="size-5" aria-hidden /> PDF → corpus chunks
          </h2>
          <InfoTip label="About PDF pre-processing">
            Extracts a textbook&apos;s text, drops running headers and page numbers, detects its
            chapters, and cuts the result into ~{form.targetTokens}-token chunks. Every chunk is
            prefixed with a citation head like{" "}
            <code className="text-primary">[Buku IPA Kelas 3, Bab 2: Wujud Benda]</code> so the
            source travels inside the text and survives retrieval.
          </InfoTip>
        </div>
        <p className="mt-1 max-w-3xl text-[13px] text-ink-soft">
          Analyze first — nothing is written until you save. Scanned books are detected and
          reported rather than silently turned into empty chunks.
        </p>

        <div className="mt-4 space-y-4">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium text-ink">Book PDF</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              disabled={busy !== null}
              onChange={(e) => chooseFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-ink-soft file:mr-3 file:rounded-md file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary hover:file:bg-primary-soft/80"
            />
            {file ? (
              <span className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-soft">
                <FileText className="size-3.5" aria-hidden />
                <span className="truncate">{file.name}</span>
                <span className="shrink-0">· {(file.size / 1024 / 1024).toFixed(1)} MB</span>
              </span>
            ) : null}
          </label>

          <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <legend className="sr-only">Book metadata</legend>
            <Field label="Title (as it should read in a citation)" required>
              <Input
                value={form.title}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="Buku IPA"
                disabled={busy !== null}
              />
            </Field>
            <Field label="Penerbit">
              <Input
                value={form.penerbit}
                onChange={(e) => patch({ penerbit: e.target.value })}
                placeholder="Kemendikbudristek"
                disabled={busy !== null}
              />
            </Field>
            <Field label="Mata pelajaran">
              <Input
                value={form.mataPelajaran}
                onChange={(e) => patch({ mataPelajaran: e.target.value })}
                placeholder="IPA"
                disabled={busy !== null}
              />
            </Field>
            <Field label="Jenjang">
              <select
                value={form.jenjang}
                onChange={(e) => patch({ jenjang: e.target.value as (typeof JENJANG)[number] })}
                disabled={busy !== null}
                className={filterSelectClassName}
              >
                {JENJANG.map((j) => (
                  <option key={j} value={j}>
                    {j}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Kelas">
              <select
                value={form.kelas}
                onChange={(e) => patch({ kelas: Number(e.target.value) })}
                disabled={busy !== null}
                className={filterSelectClassName}
              >
                {KELAS_BY_JENJANG[form.jenjang].map((k) => (
                  <option key={k} value={k}>
                    Kelas {k}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Kurikulum">
              <Input
                value={form.kurikulum}
                onChange={(e) => patch({ kurikulum: e.target.value })}
                placeholder="Merdeka"
                disabled={busy !== null}
              />
            </Field>
          </fieldset>

          <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <legend className="sr-only">Chunking</legend>
            <Field label="Chunk size (tokens, estimated)">
              <input
                type="number"
                min={100}
                max={4000}
                step={50}
                value={form.targetTokens}
                onChange={(e) => patch({ targetTokens: Number(e.target.value) })}
                disabled={busy !== null}
                className={fieldClassName}
              />
            </Field>
            <Field label="Overlap (%)">
              <input
                type="number"
                min={0}
                max={50}
                step={5}
                value={form.overlapPercent}
                onChange={(e) => patch({ overlapPercent: Number(e.target.value) })}
                disabled={busy !== null}
                className={fieldClassName}
              />
            </Field>
          </fieldset>

          {s3?.configured ? (
            <div className="rounded-lg border border-hairline bg-surface-2 p-3">
              <p className="mb-2 text-[12px] font-medium text-ink">Destination (S3 / MinIO)</p>
              <div className="flex flex-wrap gap-2">
                <label className="min-w-0 flex-1">
                  <span className="mb-1 block text-[11px] text-ink-soft">Bucket</span>
                  {s3.buckets.length > 1 ? (
                    <select
                      value={bucket}
                      onChange={(e) => setBucket(e.target.value)}
                      disabled={busy !== null}
                      className={filterSelectClassName}
                    >
                      {s3.buckets.map((b) => (
                        <option key={b} value={b}>
                          {b}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      value={bucket}
                      onChange={(e) => setBucket(e.target.value)}
                      placeholder="buku-korpus"
                      disabled={busy !== null}
                    />
                  )}
                </label>
                <label className="min-w-0 flex-1">
                  <span className="mb-1 block text-[11px] text-ink-soft">Path prefix (optional)</span>
                  <Input
                    value={prefix}
                    onChange={(e) => setPrefix(e.target.value)}
                    placeholder="(none)"
                    disabled={busy !== null}
                  />
                </label>
              </div>
              {previewKeys ? (
                <p className="mt-2 truncate font-mono text-[11px] text-ink-faint" title={previewKeys.chunks}>
                  → s3://{bucket || "<bucket>"}/{previewKeys.chunks}
                </p>
              ) : null}
            </div>
          ) : s3 ? (
            <p className="rounded-md bg-warning-soft px-3 py-2 text-[11px] text-warning">
              S3/MinIO is not configured, so results can be analyzed but not saved. Set
              <code className="mx-1">S3_ENDPOINT_URL</code> plus credentials, and allow the corpus
              bucket via <code className="mx-1">S3_ALLOWED_BUCKETS</code>.
            </p>
          ) : null}

          {error ? (
            <div className="rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-[13px] text-danger">
              {error}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" onClick={analyze} disabled={!canAnalyze}>
              {busy === "analyze" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {busy === "analyze" ? "Analyzing…" : "Analyze"}
            </Button>
            <Button type="button" onClick={handleSave} disabled={!canSave}>
              {busy === "save" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CloudUpload className="size-4" />
              )}
              {busy === "save" ? "Saving…" : "Save to corpus"}
            </Button>
            {result?.saved ? (
              <span className="text-[12px] text-success">✓ Saved — {result.saved.chunks}</span>
            ) : null}
          </div>
        </div>
      </div>

      {result ? <CorpusReport result={result} /> : null}
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[13px] font-medium text-ink">
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </span>
      {children}
    </label>
  );
}
