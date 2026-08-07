import type {
  BookCatalogEntry,
  CorpusChunk,
  TriageReport,
} from "@/lib/pdf-corpus";

/** What `/api/corpus/process` returns. `saved` is null on a dry run. */
export type CorpusProcessResult = {
  id: string;
  /** Title from the PDF's own metadata, when it had one. */
  documentTitle: string;
  catalog: BookCatalogEntry;
  triage: TriageReport;
  /** Object keys the artefacts would take (or did take) under the bucket. */
  keys: { raw: string; processed: string; chunks: string; catalog: string };
  /** `s3://…` refs, once written. Null until the run is saved. */
  saved: { raw: string; processed: string; chunks: string; catalog: string } | null;
  /** First few chunks, for the manual sample audit (langkah 1.6). */
  preview: CorpusChunk[];
};

/** Shape of `/api/datasets/s3-config`, reused for the corpus destination. */
export type S3Config = {
  configured: boolean;
  buckets: string[];
  defaultBucket: string;
};
