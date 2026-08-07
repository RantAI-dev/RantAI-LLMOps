/**
 * Server-only PDF text extraction — the ONLY place `pdfjs-dist` is imported.
 *
 * Everything downstream (`@/lib/pdf-corpus`) works on the plain
 * `{ text, size, x, y }` items this returns, so the corpus pipeline stays
 * testable without a PDF and the library stays swappable (a future OCR/VL path
 * for scanned books only has to produce the same shape).
 *
 * pdfjs is loaded through a dynamic `import()` so the ~2 MB library is pulled in
 * on the first PDF request instead of at server boot, and is listed in
 * `serverExternalPackages` (next.config.ts) so Next leaves its Node build alone.
 */
import type { OutlineEntry, PdfPage, PdfTextItem } from "@/lib/pdf-corpus";

/** A PDF we could not open (encrypted, truncated, not actually a PDF). */
export class PdfExtractError extends Error {}

/** Shape of the text items pdfjs' `getTextContent()` yields. */
type TextContentItem = {
  str?: string;
  transform?: number[];
  width?: number;
};

export type { OutlineEntry };

export type ExtractedPdf = {
  pages: PdfPage[];
  /** Title from the PDF's own metadata, when it has one — used to prefill the form. */
  documentTitle: string;
  /** Top-level bookmarks, page-resolved and in page order. Empty when absent. */
  outline: OutlineEntry[];
};

/**
 * Resolve top-level bookmarks to page numbers. A destination is either a named
 * one (a string to look up) or an explicit array whose first element is a page
 * reference — both have to be resolved through the document to get an index.
 * Anything that fails to resolve is skipped rather than guessed at.
 */
async function readOutline(doc: {
  getOutline(): Promise<Array<{ title?: string; dest?: unknown }> | null>;
  getDestination(id: string): Promise<unknown[] | null>;
  getPageIndex(ref: object): Promise<number>;
}): Promise<OutlineEntry[]> {
  const items = await doc.getOutline().catch(() => null);
  if (!items?.length) return [];

  const entries: OutlineEntry[] = [];
  for (const item of items) {
    const title = (item.title ?? "").replace(/\s+/g, " ").trim();
    if (!title) continue;
    try {
      const dest =
        typeof item.dest === "string" ? await doc.getDestination(item.dest) : item.dest;
      const ref = Array.isArray(dest) ? dest[0] : null;
      if (!ref || typeof ref !== "object") continue;
      entries.push({ title, pageNumber: (await doc.getPageIndex(ref)) + 1 });
    } catch {
      /* an unresolvable bookmark just isn't a chapter marker */
    }
  }
  return entries.sort((a, b) => a.pageNumber - b.pageNumber);
}

/**
 * Extract every page's positioned text runs.
 *
 * `data` is transferred to pdfjs, which detaches the underlying buffer — callers
 * must not reuse the array afterwards. Pass a copy if the bytes are still needed
 * (the route keeps the original `Uint8Array` for the `raw/` upload, so it hands
 * a slice in here).
 */
export async function extractPdf(data: Uint8Array): Promise<ExtractedPdf> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // Keep the loading task: in pdfjs 6 it, not the document, owns `destroy()`.
  const task = pdfjs.getDocument({
    // There is no DOM here and we only ever read the text layer, so skip font
    // rendering entirely — it is the expensive part, and every byte of this
    // file is untrusted user input.
    data,
    disableFontFace: true,
    useSystemFonts: false,
  });

  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    await task.destroy().catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    throw new PdfExtractError(`Could not read the PDF: ${message}`);
  }

  try {
    const pages: PdfPage[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const items: PdfTextItem[] = [];
        for (const raw of content.items as TextContentItem[]) {
          const text = raw.str ?? "";
          if (!text.trim()) continue;
          const transform = raw.transform ?? [];
          items.push({
            text,
            // transform = [a, b, c, d, e, f]: |a| is the horizontal scale, i.e.
            // the rendered font size, and (e, f) is the run's origin.
            size: Math.abs(transform[0] ?? 0) || 1,
            x: transform[4] ?? 0,
            y: transform[5] ?? 0,
            width: typeof raw.width === "number" ? raw.width : undefined,
          });
        }
        pages.push({ pageNumber, items });
      } finally {
        // A textbook is hundreds of pages; without this the parsed operator
        // lists for every page stay live and the process climbs into GBs.
        page.cleanup();
      }
    }

    const info = await doc.getMetadata().catch(() => null);
    const title = (info?.info as { Title?: unknown } | undefined)?.Title;

    return {
      pages,
      documentTitle: typeof title === "string" ? title.trim() : "",
      outline: await readOutline(doc),
    };
  } finally {
    await task.destroy();
  }
}

/** SHA-256 of the original file, hex — the dedup/integrity key from §3.5. */
export async function sha256Hex(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
