import type { NextRequest } from "next/server";

import { logServerError } from "@/lib/log";
import {
  chunksToJsonl,
  corpusKeys,
  DEFAULT_CHUNK_OPTIONS,
  JENJANG,
  KELAS_BY_JENJANG,
  processBook,
  type BookMetadata,
  type Jenjang,
} from "@/lib/pdf-corpus";
import { extractPdf, PdfExtractError, sha256Hex } from "@/lib/pdf-extract";
import { putObject, s3Configured } from "@/lib/s3";
import { MAX_PDF_UPLOAD_BYTES } from "@/lib/upload-limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A 300-page textbook parses in a few seconds; the cap is for pathological files. */
export const maxDuration = 300;

/** Must stay in step with `proxyClientMaxBodySize` — see src/lib/upload-limits.ts. */
const MAX_BYTES = MAX_PDF_UPLOAD_BYTES;
const MAX_MB = Math.round(MAX_BYTES / 1024 / 1024);

/** Preview rows the UI shows for the manual sample audit (langkah 1.6). */
const PREVIEW_CHUNKS = 8;

class BadRequest extends Error {}

function readMetadata(form: FormData): BookMetadata {
  const str = (key: string) => String(form.get(key) ?? "").trim();

  const title = str("title");
  if (!title) throw new BadRequest("Book title is required");
  if (title.length > 200) throw new BadRequest("Book title is too long (max 200 characters)");

  const jenjang = str("jenjang") as Jenjang;
  if (!JENJANG.includes(jenjang)) {
    throw new BadRequest(`Jenjang must be one of ${JENJANG.join(", ")}`);
  }

  const kelas = Number(str("kelas"));
  if (!KELAS_BY_JENJANG[jenjang].includes(kelas)) {
    throw new BadRequest(
      `Kelas ${str("kelas") || "—"} is not valid for ${jenjang} (expected ${KELAS_BY_JENJANG[jenjang].join(", ")})`
    );
  }

  return {
    title,
    penerbit: str("penerbit").slice(0, 200),
    mataPelajaran: str("mataPelajaran").slice(0, 120),
    jenjang,
    kelas,
    kurikulum: str("kurikulum").slice(0, 60),
  };
}

/** Read a positive number from the form, falling back to the plan's default. */
function readNumber(form: FormData, key: string, fallback: number, min: number, max: number): number {
  const raw = form.get(key);
  if (raw == null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new BadRequest(`${key} must be a number`);
  if (value < min || value > max) throw new BadRequest(`${key} must be between ${min} and ${max}`);
  return value;
}

/**
 * Pre-process one school-book PDF into citation-headed chunks — Fase 1 of the
 * corpus plan. Multipart form:
 *
 *   file            the PDF                              (required)
 *   title           book title as it appears in citations (required)
 *   jenjang         SD | SMP | SMA                        (required)
 *   kelas           1–12, must match the jenjang          (required)
 *   penerbit, mataPelajaran, kurikulum                    (optional metadata)
 *   targetTokens, overlapPercent                          (chunking, defaults 500 / 15)
 *   save            "true" to write the artefacts to S3/MinIO
 *   bucket, prefix  destination when saving
 *
 * Without `save` this is a dry run: nothing is written anywhere, and the caller
 * gets the triage, the detected chapters, and a chunk sample to eyeball first.
 */
export async function POST(req: NextRequest) {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) {
    return Response.json({ error: `Maximum PDF size is ${MAX_MB} MB` }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Body must be multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "A PDF file is required" }, { status: 400 });
  if (!/\.pdf$/i.test(file.name)) {
    return Response.json({ error: "Only .pdf files are supported" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: `Maximum PDF size is ${MAX_MB} MB` }, { status: 413 });
  }

  try {
    const metadata = readMetadata(form);
    const options = {
      targetTokens: readNumber(form, "targetTokens", DEFAULT_CHUNK_OPTIONS.targetTokens, 100, 4000),
      overlapPercent: readNumber(form, "overlapPercent", DEFAULT_CHUNK_OPTIONS.overlapPercent, 0, 50),
    };
    const save = String(form.get("save") ?? "") === "true";
    const bucket = String(form.get("bucket") ?? "").trim();
    const prefix = String(form.get("prefix") ?? "").trim();

    // Fail before spending minutes parsing a textbook we then cannot store.
    if (save) {
      if (!s3Configured()) {
        return Response.json(
          { error: "S3/MinIO is not configured — set S3_ENDPOINT_URL and credentials to save." },
          { status: 400 }
        );
      }
      if (!bucket) return Response.json({ error: "A destination bucket is required" }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const checksum = await sha256Hex(bytes);
    // pdfjs detaches the buffer it is handed, so give it a copy — `bytes` is
    // still needed for the immutable `raw/` upload below.
    const { pages, documentTitle, outline } = await extractPdf(bytes.slice());

    if (pages.length === 0) {
      return Response.json({ error: "The PDF has no pages" }, { status: 400 });
    }

    const book = processBook({
      pages,
      metadata,
      sourceFilename: file.name,
      sizeBytes: file.size,
      checksum,
      outline,
      options,
    });

    const keys = corpusKeys(book.id, metadata, prefix);
    let saved: Record<string, string> | null = null;
    if (save) {
      const jsonl = chunksToJsonl(book.chunks, book.catalog);
      // raw/ first and never overwritten in spirit (§3.5 asks for bucket
      // versioning on the bucket itself, which is a server-side setting).
      saved = {
        raw: await putObject(bucket, keys.raw, bytes, "application/pdf"),
        processed: await putObject(bucket, keys.processed, book.markdown, "text/markdown"),
        chunks: await putObject(bucket, keys.chunks, jsonl, "application/jsonl"),
        catalog: await putObject(
          bucket,
          keys.catalog,
          JSON.stringify(book.catalog, null, 2),
          "application/json"
        ),
      };
    }

    return Response.json({
      id: book.id,
      documentTitle,
      catalog: book.catalog,
      triage: book.triage,
      keys,
      saved,
      preview: book.chunks.slice(0, PREVIEW_CHUNKS),
    });
  } catch (err) {
    if (err instanceof BadRequest || err instanceof PdfExtractError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    logServerError("corpus/process", err);
    const message = err instanceof Error ? err.message : "Failed to process the PDF";
    return Response.json({ error: message }, { status: 502 });
  }
}
