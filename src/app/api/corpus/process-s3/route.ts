import type { NextRequest } from "next/server";

import { logServerError } from "@/lib/log";
import {
  chunksToJsonl,
  corpusKeys,
  DEFAULT_CHUNK_OPTIONS,
  KELAS_BY_JENJANG,
  processBook,
  slugify,
  type BookMetadata,
  type Jenjang,
} from "@/lib/pdf-corpus";
import { extractPdf, PdfExtractError, sha256Hex } from "@/lib/pdf-extract";
import { allowedBuckets, fetchObject, putObject, s3Configured } from "@/lib/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PREVIEW_CHUNKS = 8;
const ROMAN: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12,
};

/**
 * Best-effort book metadata from the S3 key/path — the same triage the batch
 * catalog stage does (jenjang + kelas from `Kelas_N` / roman numerals, title from
 * the filename). Fallbacks keep it processable when the path is uninformative;
 * the user can refine later. Never throws.
 */
function deriveMetadataFromKey(key: string): BookMetadata {
  const parts = key.split("/");
  const file = parts.pop() || key;
  const hay = ` ${key.replace(/_/g, " ")} `.toUpperCase();

  let jenjang: Jenjang = "SMP";
  if (/\b(SD|MI)\b/.test(hay)) jenjang = "SD";
  else if (/\b(SMA|SMK|\bMA\b)\b/.test(hay)) jenjang = "SMA";
  else if (/\b(SMP|MTS)\b/.test(hay)) jenjang = "SMP";

  let kelas: number | null = null;
  const num = /KELAS[ _]?(\d{1,2})/.exec(hay);
  if (num) kelas = Number(num[1]);
  if (kelas == null) {
    const rom = /KELAS[ _]+([IVX]+)\b/.exec(hay);
    if (rom && ROMAN[rom[1]]) kelas = ROMAN[rom[1]];
  }
  const valid = KELAS_BY_JENJANG[jenjang];
  if (kelas == null || !valid.includes(kelas)) kelas = valid[0];

  const title = file.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim().slice(0, 200) || file;
  // A subject folder often sits just above the file (…/Matematika/buku.pdf).
  const mataPelajaran = (parts.length ? parts[parts.length - 1] : "").replace(/[_-]+/g, " ").slice(0, 120);

  return { title, penerbit: "", mataPelajaran, jenjang, kelas, kurikulum: "" };
}

/**
 * Generate citation-headed chunks for ONE PDF already in S3 (no upload). Metadata
 * is derived from the key path. Writes `processed/`, `chunks/` and `catalog/`
 * artefacts back to the same bucket and returns a summary + chunk preview. The
 * source PDF (`raw/`) is left as-is — it is the input.
 *
 * Body JSON: `{ bucket, key, save?: boolean (default true) }`.
 */
export async function POST(req: NextRequest) {
  if (!s3Configured()) {
    return Response.json({ error: "S3/MinIO is not configured." }, { status: 400 });
  }
  let body: { bucket?: string; key?: string; save?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const bucket = (body.bucket ?? "").trim();
  const key = (body.key ?? "").trim().replace(/^\/+/, "");
  const save = body.save !== false;
  if (!bucket || !key) {
    return Response.json({ error: "`bucket` and `key` are required." }, { status: 400 });
  }
  if (!allowedBuckets().includes(bucket)) {
    return Response.json({ error: `Bucket "${bucket}" is not allowed.` }, { status: 400 });
  }
  if (!/\.pdf$/i.test(key)) {
    return Response.json({ error: "Only .pdf keys can be processed." }, { status: 400 });
  }

  try {
    const res = await fetchObject(bucket, key);
    if (!res.ok || !res.body) {
      return Response.json({ error: `Could not read s3://${bucket}/${key} (${res.status}).` }, { status: 502 });
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const checksum = await sha256Hex(bytes);
    const { pages, documentTitle, outline } = await extractPdf(bytes.slice());
    if (pages.length === 0) {
      return Response.json({ error: "The PDF has no pages (scanned? needs OCR)." }, { status: 400 });
    }

    const metadata = deriveMetadataFromKey(key);
    const book = processBook({
      pages,
      metadata,
      sourceFilename: key.split("/").pop() || key,
      sizeBytes: bytes.byteLength,
      checksum,
      outline,
      options: DEFAULT_CHUNK_OPTIONS,
    });

    // Output under a `_processed/` prefix so it stays out of the file browser and
    // never collides with the source tree.
    const keys = corpusKeys(book.id, metadata, `_processed/${slugify(bucket)}`);
    let saved: Record<string, string> | null = null;
    if (save) {
      const jsonl = chunksToJsonl(book.chunks, book.catalog);
      saved = {
        processed: await putObject(bucket, keys.processed, book.markdown, "text/markdown"),
        chunks: await putObject(bucket, keys.chunks, jsonl, "application/jsonl"),
        catalog: await putObject(bucket, keys.catalog, JSON.stringify(book.catalog, null, 2), "application/json"),
      };
    }

    return Response.json({
      id: book.id,
      source: `s3://${bucket}/${key}`,
      documentTitle,
      metadata,
      chunkCount: book.chunks.length,
      triage: book.triage,
      keys,
      saved,
      preview: book.chunks.slice(0, PREVIEW_CHUNKS),
    });
  } catch (err) {
    if (err instanceof PdfExtractError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    logServerError("corpus/process-s3", err);
    const message = err instanceof Error ? err.message : "Failed to process the PDF";
    return Response.json({ error: message }, { status: 502 });
  }
}
