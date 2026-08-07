"use client";

import { useCallback, useEffect, useState } from "react";

import {
  DEFAULT_CHUNK_OPTIONS,
  KELAS_BY_JENJANG,
  type Jenjang,
} from "@/lib/pdf-corpus";
import type { CorpusProcessResult, S3Config } from "@/modules/corpus/types";

/** Everything the operator fills in per book (langkah 1.1, inventarisasi). */
export type CorpusForm = {
  title: string;
  penerbit: string;
  mataPelajaran: string;
  jenjang: Jenjang;
  kelas: number;
  kurikulum: string;
  targetTokens: number;
  overlapPercent: number;
};

export const EMPTY_FORM: CorpusForm = {
  title: "",
  penerbit: "",
  mataPelajaran: "",
  jenjang: "SD",
  kelas: 1,
  kurikulum: "Merdeka",
  targetTokens: DEFAULT_CHUNK_OPTIONS.targetTokens,
  overlapPercent: DEFAULT_CHUNK_OPTIONS.overlapPercent,
};

/**
 * Drives the PDF → chunks panel: the form, the S3 destination, and the two
 * calls to `/api/corpus/process` (analyze = dry run, save = write to S3).
 *
 * The PDF is re-uploaded for the save call rather than parked server-side. It
 * keeps the route stateless — no temp files, no cleanup, nothing to leak — and
 * the file is already in the browser, so the cost is one local round trip.
 */
export function usePdfCorpus() {
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState<CorpusForm>(EMPTY_FORM);
  const [result, setResult] = useState<CorpusProcessResult | null>(null);
  const [busy, setBusy] = useState<"analyze" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [s3, setS3] = useState<S3Config | null>(null);
  const [bucket, setBucket] = useState("");
  const [prefix, setPrefix] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/datasets/s3-config")
      .then((r) => r.json() as Promise<S3Config>)
      .then((cfg) => {
        if (cancelled) return;
        setS3(cfg);
        setBucket(cfg.defaultBucket ?? "");
      })
      .catch(() => {
        if (!cancelled) setS3({ configured: false, buckets: [], defaultBucket: "" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const patch = useCallback((changes: Partial<CorpusForm>) => {
    setForm((f) => {
      const next = { ...f, ...changes };
      // Kelas is scoped to the jenjang — switching to SMP must not leave "3"
      // selected, which the server would (correctly) reject.
      if (changes.jenjang && !KELAS_BY_JENJANG[changes.jenjang].includes(next.kelas)) {
        next.kelas = KELAS_BY_JENJANG[changes.jenjang][0];
      }
      return next;
    });
    // The old report describes the old settings — showing it beside new inputs
    // would be a lie about what is on screen.
    setResult(null);
  }, []);

  const chooseFile = useCallback((next: File | null) => {
    setFile(next);
    setResult(null);
    setError(null);
    // Prefill the title from the filename; the operator can correct it, and it
    // beats making them retype "Bahasa Indonesia untuk SMA Kelas X".
    if (next) {
      setForm((f) =>
        f.title
          ? f
          : { ...f, title: next.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim() }
      );
    }
  }, []);

  const run = useCallback(
    async (save: boolean) => {
      if (!file) return;
      setBusy(save ? "save" : "analyze");
      setError(null);
      try {
        const body = new FormData();
        body.append("file", file);
        body.append("title", form.title);
        body.append("penerbit", form.penerbit);
        body.append("mataPelajaran", form.mataPelajaran);
        body.append("jenjang", form.jenjang);
        body.append("kelas", String(form.kelas));
        body.append("kurikulum", form.kurikulum);
        body.append("targetTokens", String(form.targetTokens));
        body.append("overlapPercent", String(form.overlapPercent));
        if (save) {
          body.append("save", "true");
          body.append("bucket", bucket.trim());
          body.append("prefix", prefix.trim());
        }
        const res = await fetch("/api/corpus/process", { method: "POST", body });
        const data = (await res.json().catch(() => ({}))) as
          | CorpusProcessResult
          | { error?: string };
        if (!res.ok || !("catalog" in data)) {
          throw new Error(("error" in data && data.error) || "Failed to process the PDF");
        }
        setResult(data);
        return data;
      } catch (err) {
        setError((err as Error).message);
        return null;
      } finally {
        setBusy(null);
      }
    },
    [file, form, bucket, prefix]
  );

  return {
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
    analyze: () => run(false),
    save: () => run(true),
  };
}
