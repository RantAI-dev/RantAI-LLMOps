/**
 * PDF corpus pre-processing — "Fase 1, Praproses Korpus" from the technical plan
 * (`rencana-teknis-asisten-belajar-rag-sft.pdf`, langkah 1.1 – 1.6):
 *
 *   1.1 inventarisasi + metadata  -> {@link buildCatalog}
 *   1.2 triase format             -> {@link triagePages} (digital vs needs-OCR)
 *   1.3 ekstraksi + strukturisasi -> {@link detectChapters} + {@link pagesToMarkdown}
 *   1.4 pembersihan               -> {@link findRunningLines} (kepala/kaki halaman berulang)
 *   1.5 pemotongan + kepala sitasi-> {@link chunkBook} + {@link citationHead}
 *   1.6 uji mutu sampel           -> the preview the UI renders from {@link processBook}
 *
 * This module is deliberately FREE of any PDF library and of any Node/browser
 * API: it takes already-extracted text items (see `@/lib/pdf-extract`, the only
 * place `pdfjs-dist` is imported) and returns plain data. That keeps the part
 * with all the judgement calls — where a chapter starts, which lines are page
 * furniture, where a chunk may be cut — unit-testable without a real PDF.
 *
 * Coordinates follow the PDF convention: the origin is the BOTTOM-left, so a
 * LARGER `y` is HIGHER on the page and reading order is `y` descending.
 */

/** One text run as the extractor reports it. `size` is the rendered font size. */
export type PdfTextItem = {
  text: string;
  size: number;
  x: number;
  y: number;
  /** Rendered width, when the extractor knows it — used to tell a kerning split
   *  ("obser" + "vasi") from two separate words. */
  width?: number;
};

/** One page's text runs, in the order the PDF's content stream emits them. */
export type PdfPage = {
  pageNumber: number;
  items: PdfTextItem[];
};

/** A top-level PDF bookmark resolved to the page it points at (1-based). */
export type OutlineEntry = { title: string; pageNumber: number };

/** Text runs merged into a visual line, ordered left-to-right. */
export type PdfLine = {
  text: string;
  /** Largest font size on the line — what makes a heading a heading. */
  size: number;
  y: number;
  pageNumber: number;
};

export const JENJANG = ["SD", "SMP", "SMA"] as const;
export type Jenjang = (typeof JENJANG)[number];

/** Kelas that belong to each jenjang — also the bounds the form validates against. */
export const KELAS_BY_JENJANG: Record<Jenjang, number[]> = {
  SD: [1, 2, 3, 4, 5, 6],
  SMP: [7, 8, 9],
  SMA: [10, 11, 12],
};

/** What the operator records per book at inventarisasi time (langkah 1.1). */
export type BookMetadata = {
  /** Book title as it should read inside a citation, e.g. "Buku IPA". */
  title: string;
  penerbit: string;
  mataPelajaran: string;
  jenjang: Jenjang;
  kelas: number;
  /** "K13" | "Merdeka" | "" — free text; the plan only asks that it be recorded. */
  kurikulum: string;
};

export type ChunkOptions = {
  /** Target chunk size in tokens. The plan asks for ~500. */
  targetTokens: number;
  /** Overlap between neighbouring chunks, as a percentage. The plan asks for 15. */
  overlapPercent: number;
};

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  targetTokens: 500,
  overlapPercent: 15,
};

/** A chapter ("bab") and the page range it covers. */
export type Chapter = {
  /** 1-based position in the book — not the printed number, which may be roman. */
  index: number;
  /** The printed number as written, e.g. "I" or "3". Empty when unnumbered. */
  number: string;
  title: string;
  /** Rendered citation form, e.g. "Bab 2: Wujud Benda". */
  label: string;
  startPage: number;
  /** Inclusive. */
  endPage: number;
  /** How the chapter was found — surfaced in the UI so a wrong guess is visible. */
  source: "outline" | "heading" | "running-header" | "fallback";
  /**
   * Top of the chapter's title block on its opening page, when it was found by
   * typography. Everything above it is cover/colophon matter to drop (langkah 1.4).
   */
  markerY?: number;
};

/** Per-page verdict for the format triage (langkah 1.2). */
export type PageTriage = {
  pageNumber: number;
  charCount: number;
  /** Too little extractable text to be a digital page — it needs the OCR path. */
  needsOcr: boolean;
};

export type TriageReport = {
  totalPages: number;
  digitalPages: number;
  ocrPages: number;
  /** Share of pages that need OCR, 0–1. Drives the whole-book verdict. */
  ocrRatio: number;
  /**
   * Whole-book verdict. "digital" = extract directly; "mixed" = usable but some
   * pages (usually scanned plates) will be missing; "needs-ocr" = the text layer
   * is essentially absent, so this book belongs in the VL/OCR queue instead.
   */
  verdict: "digital" | "mixed" | "needs-ocr";
  pages: PageTriage[];
};

/** One ready-to-ingest chunk. `text` already carries the citation head. */
export type CorpusChunk = {
  id: string;
  text: string;
  citation: string;
  chapterIndex: number;
  chapterLabel: string;
  pageStart: number;
  pageEnd: number;
  tokens: number;
};

export type ProcessStats = {
  chunkCount: number;
  totalTokens: number;
  averageTokens: number;
  /** Pages dropped as front matter (cover, colophon, daftar isi) before Bab 1. */
  frontMatterPages: number;
  /** Distinct running header/footer lines removed (langkah 1.4). */
  runningLinesRemoved: number;
  /** Chapters whose title could not be read — worth a manual look. */
  untitledChapters: number;
};

export type BookCatalogEntry = {
  id: string;
  metadata: BookMetadata;
  /** Knowledge base this book's chunks belong to, e.g. "smakelas10" (§3.2). */
  knowledgeBase: string;
  sourceFilename: string;
  sizeBytes: number;
  /** SHA-256 of the original file — for dedup + integrity (§3.5). */
  checksum: string;
  pageCount: number;
  triage: Omit<TriageReport, "pages">;
  chapters: Chapter[];
  chunkOptions: ChunkOptions;
  stats: ProcessStats;
};

export type ProcessedBook = {
  id: string;
  catalog: BookCatalogEntry;
  markdown: string;
  chunks: CorpusChunk[];
  triage: TriageReport;
};

/* ------------------------------------------------------------------ *
 * Small shared helpers
 * ------------------------------------------------------------------ */

/**
 * Rough token count. The real number depends on the tokenizer (SEA-LION/Qwen),
 * which we deliberately do not load here — chunk sizes are a retrieval-quality
 * knob, not a hard budget, so an estimate that is stable and cheap beats an
 * exact one that drags a tokenizer into a request path. ~3.8 chars/token is
 * what Qwen-family BPE averages on Indonesian prose.
 */
export function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.length / 3.8);
}

/** Slug used for object keys and chunk ids. */
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Knowledge base name for a jenjang+kelas pair, per §3.2 ("smakelas10"). */
export function knowledgeBaseName(jenjang: Jenjang, kelas: number): string {
  return `${jenjang.toLowerCase()}kelas${kelas}`;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];

/** Roman numeral -> number, for chapter markers written "BAB IV". Only 1–12 —
 *  beyond that a "chapter" is almost certainly a false positive. */
function romanToNumber(value: string): number | null {
  const i = ROMAN.indexOf(value.toUpperCase());
  return i === -1 ? null : i + 1;
}

/* ------------------------------------------------------------------ *
 * 1.3 Lines — merge text runs into visual lines
 * ------------------------------------------------------------------ */

/** Vertical slack, as a fraction of font size, within which runs share a line. */
const LINE_Y_TOLERANCE = 0.3;
/**
 * Runs whose font sizes differ by more than this are never merged, however close
 * their baselines. Display layouts stack a huge chapter numeral against the
 * title beside it — merging those makes one line whose "size" is the numeral's,
 * which then hides the real title from chapter detection.
 */
const LINE_SIZE_RATIO = 1.6;
/** A horizontal gap wider than this share of the font size is a real space. */
const GAP_SPACE_RATIO = 0.18;

/**
 * Merge a page's text runs into visual lines, ordered top-to-bottom then
 * left-to-right. Extractors emit runs in content-stream order, which for a
 * multi-column or decorated layout is NOT reading order — sorting by geometry
 * is what makes the rest of the pipeline see the page the way a reader does.
 */
export function toLines(page: PdfPage): PdfLine[] {
  const items = page.items.filter((i) => i.text.trim().length > 0);
  if (items.length === 0) return [];

  const byY = [...items].sort((a, b) => b.y - a.y);
  const groups: PdfTextItem[][] = [];
  for (const item of byY) {
    const current = groups[groups.length - 1];
    const anchor = current?.[0];
    const slack = Math.max(anchor?.size ?? 0, item.size) * LINE_Y_TOLERANCE;
    const sameSize =
      anchor != null &&
      Math.max(anchor.size, item.size) / Math.max(1, Math.min(anchor.size, item.size)) <=
        LINE_SIZE_RATIO;
    if (anchor && sameSize && Math.abs(anchor.y - item.y) <= slack) current.push(item);
    else groups.push([item]);
  }

  return groups.map((group) => {
    const ordered = [...group].sort((a, b) => a.x - b.x);
    // Join with a space only where there is a real gap. PDFs routinely split one
    // word across runs at a kerning pair ("obser" + "vasi"), and a space there
    // breaks the word — which then breaks search, chunk text, and citations.
    let text = "";
    let previous: PdfTextItem | null = null;
    for (const run of ordered) {
      if (text && !/\s$/.test(text) && !/^\s/.test(run.text)) {
        const gap = previous?.width == null ? null : run.x - (previous.x + previous.width);
        // Without a width we cannot tell; a space is the safer default there,
        // since a missing space merges two words invisibly.
        if (gap == null || gap > run.size * GAP_SPACE_RATIO) text += " ";
      }
      text += run.text;
      previous = run;
    }
    return {
      text: text.replace(/\s+/g, " ").trim(),
      size: Math.max(...ordered.map((r) => r.size)),
      y: Math.max(...ordered.map((r) => r.y)),
      pageNumber: page.pageNumber,
    };
  });
}

/**
 * The book's body font size — the size that covers the most CHARACTERS (not the
 * most lines, which headings and captions would skew). Everything larger is a
 * heading candidate.
 */
export function bodyFontSize(pages: PdfLine[][]): number {
  const weight = new Map<number, number>();
  for (const lines of pages) {
    for (const line of lines) {
      const size = Math.round(line.size);
      weight.set(size, (weight.get(size) ?? 0) + line.text.length);
    }
  }
  let best = 10;
  let bestWeight = -1;
  for (const [size, chars] of weight) {
    if (chars > bestWeight) {
      best = size;
      bestWeight = chars;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * 1.2 Triase format
 * ------------------------------------------------------------------ */

/** Below this many extractable characters a page is treated as scanned/image. */
const THIN_PAGE_CHARS = 120;
/** Above this share of thin pages the book belongs in the OCR queue. */
const NEEDS_OCR_RATIO = 0.5;
/** Above this share it is usable but lossy — the operator should know. */
const MIXED_RATIO = 0.1;

/**
 * Split pages into "digital text we can extract" and "needs the OCR/VL path"
 * (langkah 1.2). The ratio is what sizes the OCR pipeline, so it is reported
 * per page as well as in aggregate.
 */
export function triagePages(pages: PdfPage[]): TriageReport {
  const perPage: PageTriage[] = pages.map((page) => {
    const charCount = page.items.reduce((sum, item) => sum + item.text.trim().length, 0);
    return { pageNumber: page.pageNumber, charCount, needsOcr: charCount < THIN_PAGE_CHARS };
  });
  const ocrPages = perPage.filter((p) => p.needsOcr).length;
  const totalPages = perPage.length;
  const ocrRatio = totalPages === 0 ? 0 : ocrPages / totalPages;
  const verdict: TriageReport["verdict"] =
    ocrRatio >= NEEDS_OCR_RATIO ? "needs-ocr" : ocrRatio > MIXED_RATIO ? "mixed" : "digital";
  return {
    totalPages,
    digitalPages: totalPages - ocrPages,
    ocrPages,
    ocrRatio,
    verdict,
    pages: perPage,
  };
}

/* ------------------------------------------------------------------ *
 * 1.4 Pembersihan — running headers / footers / page numbers
 * ------------------------------------------------------------------ */

/** How many lines at each page edge can be page furniture. */
const EDGE_LINES = 3;
/**
 * A line must repeat on at least this share of pages to count as furniture.
 * Kept low on purpose: the most common Indonesian textbook header is
 * "Bab N | Chapter Title", which changes every chapter and so only ever recurs
 * across ONE chapter's pages — a 20% threshold never sees it.
 */
const RUNNING_LINE_RATIO = 0.05;
/** …and on at least this many pages, so a 4-page document isn't gutted. */
const RUNNING_LINE_MIN_PAGES = 4;

/**
 * Normalise a line for repetition counting: drop digits (the page number varies)
 * and punctuation, collapse space, lowercase. "Bab 1 | Beragam Jalan" and
 * "Bab 7 | Beragam Jalan" therefore hash the same and are both recognised.
 */
function normalizeForRepetition(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d+/g, "")
    .replace(/[^\p{L}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A line that is nothing but a page number (or a number plus stray marks). */
function isPageNumberLine(text: string): boolean {
  return /^[^\p{L}]*\d{1,4}[^\p{L}]*$/u.test(text.trim());
}

/**
 * How many lines at each edge of THIS page may be furniture. A page with few
 * lines would otherwise be entirely "edge", so its body text could be voted off
 * as a running header — never remove more than a third of a page this way.
 */
function edgeCount(lineCount: number): number {
  return Math.min(EDGE_LINES, Math.max(1, Math.floor(lineCount / 3)));
}

/** The candidate furniture lines at the top and bottom of a page. */
function edgeLines(lines: PdfLine[]): PdfLine[] {
  const n = edgeCount(lines.length);
  return [...lines.slice(0, n), ...lines.slice(-n)];
}

/**
 * Find the repeated header/footer lines to strip (langkah 1.4). Only the first
 * and last few lines of each page are considered, so a sentence that legitimately
 * recurs mid-body is never removed.
 */
export function findRunningLines(pages: PdfLine[][]): Set<string> {
  const counts = new Map<string, number>();
  for (const lines of pages) {
    const edges = edgeLines(lines);
    // Count each distinct normalised form once per page — a header repeated
    // twice on one page must not count as two pages' worth of evidence.
    const seen = new Set<string>();
    for (const line of edges) {
      const key = normalizeForRepetition(line.text);
      if (!key || key.length < 4) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(RUNNING_LINE_MIN_PAGES, pages.length * RUNNING_LINE_RATIO);
  const running = new Set<string>();
  for (const [key, count] of counts) {
    if (count >= threshold) running.add(key);
  }
  return running;
}

/** Drop page furniture from one page's lines. */
function stripRunningLines(lines: PdfLine[], running: Set<string>): PdfLine[] {
  const n = edgeCount(lines.length);
  return lines.filter((line, index) => {
    const isEdge = index < n || index >= lines.length - n;
    if (!isEdge) return true;
    if (isPageNumberLine(line.text)) return false;
    // "Bab 3 | Menyusuri Kisah Lintas Zaman" at a page edge is a running header
    // by construction — no repetition evidence needed.
    if (CHAPTER_WITH_TITLE.test(line.text.trim())) return false;
    return !running.has(normalizeForRepetition(line.text));
  });
}

/* ------------------------------------------------------------------ *
 * 1.3 Chapter detection
 * ------------------------------------------------------------------ */

/** A heading is this much larger than body text. */
const HEADING_SIZE_RATIO = 1.35;
/**
 * Title lines must be within this fraction of the DOMINANT title size on the
 * chapter-opener page. Without a band, a smaller-but-still-large heading further
 * down the page ("Tujuan Pembelajaran") gets glued onto the chapter title.
 */
const TITLE_SIZE_BAND = 0.8;
/** "BAB", "Bab 3", "BAB IV" — with the number optional because some layouts set
 *  the word and the numeral as separate, differently sized runs. */
const CHAPTER_MARKER = /^bab\b\s*([ivxlcdm]+|\d{1,2})?\s*$/i;
/** A marker that carries its title inline: "Bab 1 | Beragam Jalan …". */
const CHAPTER_WITH_TITLE = /^bab\s*([ivxlcdm]+|\d{1,2})\s*[|:.–—-]\s*(.+)$/i;

/** Render the citation form of a chapter. */
function chapterLabel(number: string, title: string): string {
  const head = number ? `Bab ${number}` : "Bab";
  return title ? `${head}: ${title}` : head;
}

/**
 * Find chapter openers by typography: on a chapter's first page the word "Bab"
 * (with or without its numeral) is set far larger than body text, and the title
 * sits beside it at a comparable size.
 *
 * `pages` must already have running headers stripped, otherwise the "Bab 1 |"
 * that repeats on every page of a chapter is mistaken for an opener.
 */
function detectChaptersByHeading(pages: PdfLine[][], bodySize: number): Chapter[] {
  const threshold = bodySize * HEADING_SIZE_RATIO;
  const found: ChapterStart[] = [];

  for (const lines of pages) {
    const headings = lines.filter((line) => line.size >= threshold);
    if (headings.length === 0) continue;

    const markerIndex = headings.findIndex((line) => CHAPTER_MARKER.test(line.text));
    if (markerIndex === -1) continue;
    const marker = headings[markerIndex];

    // The numeral may live on the marker line ("Bab 3") or be a separate run set
    // even larger than the word itself ("Bab" / "1" stacked). Look for a bare
    // numeral among the other headings when the marker has none.
    let number = CHAPTER_MARKER.exec(marker.text)?.[1] ?? "";
    const numeralLines = new Set<PdfLine>([marker]);
    if (!number) {
      const numeral = headings.find(
        (line) => line !== marker && /^([ivxlcdm]{1,4}|\d{1,2})$/i.test(line.text)
      );
      if (numeral) {
        number = numeral.text;
        numeralLines.add(numeral);
      }
    }

    // Title = the remaining headings at the page's DOMINANT title size, read top
    // to bottom. Dominant (most characters set at it) rather than largest,
    // because a display numeral is often the single biggest thing on the page.
    const titleLines = headings.filter((line) => !numeralLines.has(line));
    const dominant = dominantSize(titleLines);
    const title = titleLines
      .filter((line) => line.size >= dominant * TITLE_SIZE_BAND)
      .map((line) => line.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const roman = romanToNumber(number);
    found.push({
      // Normalise roman to arabic so citations read "Bab 4", not "Bab IV".
      number: roman ? String(roman) : number,
      title,
      startPage: marker.pageNumber,
      markerY: Math.max(marker.y, ...headings.map((h) => h.y)),
    });
  }

  return closeChapters(found, "heading");
}

/** The font size carrying the most characters in a set of lines. */
function dominantSize(lines: PdfLine[]): number {
  const weight = new Map<number, number>();
  for (const line of lines) {
    weight.set(line.size, (weight.get(line.size) ?? 0) + line.text.length);
  }
  let best = 0;
  let bestWeight = -1;
  for (const [size, chars] of weight) {
    if (chars > bestWeight) {
      best = size;
      bestWeight = chars;
    }
  }
  return best;
}

/**
 * Fallback: many textbooks put "Bab 1 | Chapter Title" in the running header of
 * every page of the chapter. That was stripped as furniture, so this reads the
 * RAW pages — the repetition that makes it noise for the body is exactly what
 * makes it a reliable chapter map.
 */
function detectChaptersByRunningHeader(pages: PdfLine[][]): Chapter[] {
  const found: Array<{ number: string; title: string; startPage: number }> = [];
  let lastNumber = "";
  for (const lines of pages) {
    for (const line of edgeLines(lines)) {
      const match = CHAPTER_WITH_TITLE.exec(line.text.trim());
      if (!match) continue;
      const roman = romanToNumber(match[1]);
      const number = roman ? String(roman) : match[1];
      if (number === lastNumber) break;
      lastNumber = number;
      // The page number usually sits on the same baseline as the header and so
      // merges into the line — it is not part of the chapter title.
      const title = match[2].trim().replace(/\s+\d{1,4}$/, "").trim();
      found.push({ number, title, startPage: line.pageNumber });
      break;
    }
  }
  return closeChapters(found, "running-header");
}

type ChapterStart = { number: string; title: string; startPage: number; markerY?: number };

/** Turn chapter starts into chapters, dropping duplicate openers. */
function closeChapters(starts: ChapterStart[], source: Chapter["source"]): Chapter[] {
  const unique: ChapterStart[] = [];
  for (const start of starts) {
    const previous = unique[unique.length - 1];
    // Two openers on the same page, or a repeat of the same PRINTED number, means
    // one is a false positive — keep the first (nearer the page top). An empty
    // number is "unknown", not a match: comparing those would silently collapse
    // every chapter whose numeral we failed to read into one.
    const samePage = previous?.startPage === start.startPage;
    const sameNumber = Boolean(previous && start.number && previous.number === start.number);
    if (previous && (samePage || sameNumber)) continue;
    unique.push(start);
  }
  return unique.map((start, index) => ({
    index: index + 1,
    number: start.number || String(index + 1),
    title: start.title,
    label: chapterLabel(start.number || String(index + 1), start.title),
    startPage: start.startPage,
    endPage: Number.MAX_SAFE_INTEGER, // closed by the caller, which knows the last page
    markerY: start.markerY,
    source,
  }));
}

/**
 * Chapters straight from the PDF's bookmarks — by far the most reliable signal
 * when a publisher ships them, because it is the author's own structure rather
 * than something inferred from font sizes. Front matter bookmarks (cover, kata
 * pengantar, daftar isi) are dropped so chapter 1 really is chapter 1.
 */
const FRONT_MATTER_TITLE =
  /^(sampul|cover|hak cipta|kata pengantar|prakata|daftar (isi|gambar|tabel|pustaka)|glosarium|indeks|profil|biodata|lampiran|daftar)/i;

function detectChaptersFromOutline(outline: OutlineEntry[]): Chapter[] {
  const found: Array<{ number: string; title: string; startPage: number }> = [];
  for (const entry of outline) {
    if (FRONT_MATTER_TITLE.test(entry.title)) continue;
    const withTitle = CHAPTER_WITH_TITLE.exec(entry.title);
    const bare = /^bab\s*([ivxlcdm]+|\d{1,2})\s+(.+)$/i.exec(entry.title);
    const match = withTitle ?? bare;
    const rawNumber = match?.[1] ?? "";
    const roman = romanToNumber(rawNumber);
    found.push({
      number: roman ? String(roman) : rawNumber,
      title: (match?.[2] ?? entry.title).trim(),
      startPage: entry.pageNumber,
    });
  }
  return closeChapters(found, "outline");
}

/**
 * Detect the book's chapters. Bookmarks win when present; otherwise typography,
 * then the running header, and finally a single whole-book section so a book
 * with no recognisable structure still produces citable chunks.
 */
export function detectChapters(
  rawPages: PdfLine[][],
  cleanedPages: PdfLine[][],
  bodySize: number,
  lastPage: number,
  outline: OutlineEntry[] = []
): Chapter[] {
  const fromOutline = detectChaptersFromOutline(outline);
  if (fromOutline.length >= 2) return closeRanges(fromOutline, lastPage);

  let chapters = detectChaptersByHeading(cleanedPages, bodySize);
  // One "chapter" for a whole textbook is a detection failure, not a structure.
  if (chapters.length < 2) {
    const fromHeader = detectChaptersByRunningHeader(rawPages);
    if (fromHeader.length > chapters.length) chapters = fromHeader;
  }
  if (chapters.length === 0) {
    return [
      {
        index: 1,
        number: "",
        title: "",
        label: "",
        startPage: 1,
        endPage: lastPage,
        source: "fallback",
      },
    ];
  }
  return closeRanges(chapters, lastPage);
}

/** Each chapter runs until the next one starts; the last runs to the last page. */
function closeRanges(chapters: Chapter[], lastPage: number): Chapter[] {
  return chapters.map((chapter, index) => ({
    ...chapter,
    endPage: index + 1 < chapters.length ? chapters[index + 1].startPage - 1 : lastPage,
  }));
}

/* ------------------------------------------------------------------ *
 * 1.3/1.4 Markdown — paragraphs and sub-headings
 * ------------------------------------------------------------------ */

/** A sub-heading ("subbab") is larger than body text but below chapter size. */
const SUBHEADING_SIZE_RATIO = 1.12;
/** …and short. A long "heading" is really an emphasised sentence. */
const SUBHEADING_MAX_CHARS = 90;
/** A line shorter than this share of the page's typical line ends a paragraph. */
const SHORT_LINE_RATIO = 0.62;

type Block = { kind: "heading" | "paragraph"; text: string; pageNumber: number };

/** Lettered/numbered sub-heads ("A. Menyimak", "1. Pengertian") that textbooks
 *  set at body size — typography alone would miss these. */
const NUMBERED_SUBHEAD = /^(?:[A-Z]|\d{1,2})[.)]\s+\p{Lu}/u;

function isSubheading(line: PdfLine, bodySize: number): boolean {
  if (line.text.length > SUBHEADING_MAX_CHARS) return false;
  if (line.size >= bodySize * SUBHEADING_SIZE_RATIO) return true;
  return NUMBERED_SUBHEAD.test(line.text);
}

/**
 * Turn cleaned lines into blocks: sub-headings, and paragraphs re-flowed from
 * the hard-wrapped lines a PDF stores. Two signals end a paragraph — a line that
 * ends a sentence, and a line noticeably shorter than the column width (the last
 * line of a paragraph). Hyphenated wraps are rejoined.
 */
export function linesToBlocks(lines: PdfLine[], bodySize: number): Block[] {
  if (lines.length === 0) return [];
  const lengths = [...lines.map((l) => l.text.length)].sort((a, b) => a - b);
  const medianLength = lengths[Math.floor(lengths.length / 2)] || 1;

  const blocks: Block[] = [];
  let buffer = "";
  let bufferPage = lines[0].pageNumber;

  const flush = () => {
    const text = buffer.replace(/\s+/g, " ").trim();
    if (text) blocks.push({ kind: "paragraph", text, pageNumber: bufferPage });
    buffer = "";
  };

  for (const line of lines) {
    if (isSubheading(line, bodySize)) {
      flush();
      blocks.push({ kind: "heading", text: line.text, pageNumber: line.pageNumber });
      continue;
    }
    if (!buffer) bufferPage = line.pageNumber;
    if (buffer.endsWith("-")) {
      // "men-" + "unjukkan" -> "menunjukkan". Only when the next line starts
      // lowercase; "e-" + "Modul" is a real hyphen and must survive.
      if (/^\p{Ll}/u.test(line.text)) buffer = buffer.slice(0, -1) + line.text;
      else buffer += line.text;
    } else {
      buffer += (buffer ? " " : "") + line.text;
    }

    const endsSentence = /[.!?:;"”’)]$/.test(line.text);
    const isShort = line.text.length < medianLength * SHORT_LINE_RATIO;
    if (endsSentence && isShort) flush();
  }
  flush();
  return blocks;
}

/** Render blocks as Markdown, with chapters as `##` and sub-heads as `###`. */
export function pagesToMarkdown(
  metadata: BookMetadata,
  chapters: Chapter[],
  blocksByChapter: Block[][]
): string {
  const out: string[] = [`# ${bookLabel(metadata)}`, ""];
  chapters.forEach((chapter, index) => {
    if (chapter.label) out.push(`## ${chapter.label}`, "");
    for (const block of blocksByChapter[index] ?? []) {
      out.push(block.kind === "heading" ? `### ${block.text}` : block.text, "");
    }
  });
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/* ------------------------------------------------------------------ *
 * 1.5 Pemotongan + kepala sitasi
 * ------------------------------------------------------------------ */

/**
 * How a book names itself inside a citation. The kelas is appended unless the
 * title already carries it, so "Buku IPA" + kelas 3 reads "Buku IPA Kelas 3"
 * while "Bahasa Indonesia Kelas X" is left alone.
 */
export function bookLabel(metadata: BookMetadata): string {
  const title = metadata.title.trim();
  if (/\bkelas\b/i.test(title)) return title;
  return `${title} Kelas ${metadata.kelas}`;
}

/**
 * The citation head every chunk is prefixed with (§3.4). Because the knowledge
 * base is flat and document metadata may not survive retrieval, the source has
 * to travel INSIDE the text — this is that guarantee.
 */
export function citationHead(metadata: BookMetadata, chapter: Chapter): string {
  const book = bookLabel(metadata);
  return chapter.label ? `[${book}, ${chapter.label}]` : `[${book}]`;
}

/** Split text into sentences, keeping their terminal punctuation. */
function toSentences(text: string): string[] {
  return text.match(/[^.!?]+[.!?]+[\])'"”’]*\s*|[^.!?]+$/g) ?? [text];
}

/** The last whole sentences of `text` that fit in `budget` tokens. */
function trailingSentences(text: string, budget: number): string {
  if (budget <= 0) return "";
  const sentences = toSentences(text);
  const carried: string[] = [];
  let tokens = 0;
  for (let i = sentences.length - 1; i >= 0; i--) {
    const cost = estimateTokens(sentences[i]);
    // Always take at least one sentence when the budget allows any overlap at
    // all — otherwise a book of long sentences would get no overlap ever.
    if (carried.length > 0 && tokens + cost > budget) break;
    carried.unshift(sentences[i]);
    tokens += cost;
    if (tokens >= budget) break;
  }
  return carried.join("").trim();
}

/**
 * A block bigger than the target has to be cut somewhere; cut it at sentence
 * ends so no chunk stops mid-clause. Falls back to a hard character split only
 * for text with no sentence punctuation at all (tables, formula dumps).
 */
function splitLongBlock(block: Block, target: number): Block[] {
  if (estimateTokens(block.text) <= target) return [block];
  const sentences = toSentences(block.text);
  const out: Block[] = [];
  let buffer = "";
  for (const sentence of sentences) {
    if (buffer && estimateTokens(buffer + sentence) > target) {
      out.push({ ...block, text: buffer.trim() });
      buffer = "";
    }
    // A single sentence over the target still has to go somewhere — emit it
    // whole rather than truncating a fact in half.
    buffer += sentence;
  }
  if (buffer.trim()) out.push({ ...block, text: buffer.trim() });
  return out;
}

/**
 * Cut one chapter's blocks into ~`targetTokens` chunks with `overlapPercent`
 * carry-over, breaking at block boundaries and preferring sub-heading boundaries
 * (the plan's "mengikuti batas subbab").
 *
 * A sub-heading only forces a break once the current chunk is already
 * substantial. Breaking at every sub-head sounds tidier but shreds a textbook —
 * these books head almost every exercise and numbered step, which would yield
 * hundreds of 50-token fragments that retrieve badly.
 */
export function chunkBlocks(
  blocks: Block[],
  options: ChunkOptions
): Array<{ text: string; pageStart: number; pageEnd: number; tokens: number }> {
  const target = Math.max(50, options.targetTokens);
  const overlapTokens = Math.round((target * Math.min(90, Math.max(0, options.overlapPercent))) / 100);
  /** Below this a chunk is too small to be worth cutting at a sub-heading. */
  const breakFloor = target * 0.6;
  const out: Array<{ text: string; pageStart: number; pageEnd: number; tokens: number }> = [];

  let current: Block[] = [];
  let currentTokens = 0;

  const emit = () => {
    if (current.length === 0) return;
    const text = current
      .map((b) => (b.kind === "heading" ? `## ${b.text}` : b.text))
      .join("\n\n")
      .trim();
    if (!text) {
      current = [];
      currentTokens = 0;
      return;
    }
    const pageEnd = Math.max(...current.map((b) => b.pageNumber));
    out.push({
      text,
      pageStart: Math.min(...current.map((b) => b.pageNumber)),
      pageEnd,
      tokens: estimateTokens(text),
    });
    // Carry the chunk's trailing SENTENCES forward as overlap, so a fact split
    // across the cut is retrievable from either side. Sentences rather than
    // whole blocks: a textbook paragraph is often larger than the whole overlap
    // budget, and a block-granular carry would silently produce no overlap.
    const carry = trailingSentences(
      current.map((b) => b.text).join(" "),
      Math.min(overlapTokens, Math.round(target * 0.5))
    );
    current = carry ? [{ kind: "paragraph", text: carry, pageNumber: pageEnd }] : [];
    currentTokens = estimateTokens(carry);
  };

  const pieces = blocks.flatMap((block) => splitLongBlock(block, target));
  for (const block of pieces) {
    const tokens = estimateTokens(block.text);
    if (!tokens) continue;
    // A sub-heading opens a new chunk — but only once there is a real chunk to
    // close — and stays attached to the text that follows it.
    if (block.kind === "heading" && currentTokens >= breakFloor) {
      emit();
      current = [];
      currentTokens = 0;
    }
    if (currentTokens + tokens > target && currentTokens > 0) emit();
    current.push(block);
    currentTokens += tokens;
  }
  emit();
  // The final emit() leaves the overlap tail behind; anything still buffered was
  // already published as part of the last chunk, so it is dropped on purpose.
  return out;
}

/* ------------------------------------------------------------------ *
 * Object-storage layout (§3.5)
 * ------------------------------------------------------------------ */

/**
 * Where a book's artefacts live under the corpus bucket. The path carries
 * jenjang / kelas / mata pelajaran so the key itself is queryable, per §3.5.
 */
export function corpusKeys(id: string, metadata: BookMetadata, prefix = "") {
  const clean = prefix.replace(/^\/+|\/+$/g, "");
  const scope = `${metadata.jenjang.toLowerCase()}/kelas-${metadata.kelas}/${
    slugify(metadata.mataPelajaran) || "umum"
  }/${id}`;
  const at = (stage: string, ext: string) =>
    `${clean ? `${clean}/` : ""}${stage}/${scope}.${ext}`;
  return {
    raw: at("raw", "pdf"),
    processed: at("processed", "md"),
    chunks: at("chunks", "jsonl"),
    catalog: at("catalog", "json"),
  };
}

/** Chunks as JSONL — one ingest-ready record per line. */
export function chunksToJsonl(chunks: CorpusChunk[], catalog: BookCatalogEntry): string {
  return (
    chunks
      .map((chunk) =>
        JSON.stringify({
          id: chunk.id,
          text: chunk.text,
          citation: chunk.citation,
          book: catalog.metadata.title,
          penerbit: catalog.metadata.penerbit,
          mata_pelajaran: catalog.metadata.mataPelajaran,
          jenjang: catalog.metadata.jenjang,
          kelas: catalog.metadata.kelas,
          kurikulum: catalog.metadata.kurikulum,
          knowledge_base: catalog.knowledgeBase,
          chapter: chunk.chapterLabel,
          chapter_index: chunk.chapterIndex,
          page_start: chunk.pageStart,
          page_end: chunk.pageEnd,
          tokens: chunk.tokens,
          source_checksum: catalog.checksum,
        })
      )
      .join("\n") + "\n"
  );
}

/* ------------------------------------------------------------------ *
 * The pipeline
 * ------------------------------------------------------------------ */

export type ProcessInput = {
  pages: PdfPage[];
  metadata: BookMetadata;
  sourceFilename: string;
  sizeBytes: number;
  checksum: string;
  /** The PDF's own bookmarks, when it has any — the best chapter signal there is. */
  outline?: OutlineEntry[];
  options?: Partial<ChunkOptions>;
};

/**
 * Run langkah 1.2 – 1.5 over one book's extracted pages and return everything
 * the caller needs to store it: the catalog entry, the cleaned Markdown, and
 * the citation-headed chunks.
 */
export function processBook(input: ProcessInput): ProcessedBook {
  const options: ChunkOptions = { ...DEFAULT_CHUNK_OPTIONS, ...input.options };
  const triage = triagePages(input.pages);

  const rawPages = input.pages.map(toLines);
  const bodySize = bodyFontSize(rawPages);
  const running = findRunningLines(rawPages);
  const cleanedPages = rawPages.map((lines) => stripRunningLines(lines, running));

  const lastPage = input.pages.length === 0 ? 0 : input.pages[input.pages.length - 1].pageNumber;
  const chapters = detectChapters(rawPages, cleanedPages, bodySize, lastPage, input.outline);

  // Everything before the first chapter is cover + colophon + daftar isi, which
  // the plan asks us to drop (langkah 1.4) — it is navigation, not knowledge.
  const firstContentPage = chapters[0]?.startPage ?? 1;
  const frontMatterPages = Math.max(0, firstContentPage - 1);

  const id = slugify(`${input.metadata.title}-${input.metadata.jenjang}-${input.metadata.kelas}`) ||
    slugify(input.sourceFilename.replace(/\.pdf$/i, "")) ||
    "book";

  const pageIndex = new Map<number, PdfLine[]>();
  cleanedPages.forEach((lines, i) => pageIndex.set(input.pages[i].pageNumber, lines));

  const blocksByChapter: Block[][] = [];
  const chunks: CorpusChunk[] = [];

  const headingThreshold = bodySize * HEADING_SIZE_RATIO;
  chapters.forEach((chapter) => {
    const lines: PdfLine[] = [];
    for (let page = chapter.startPage; page <= chapter.endPage; page++) {
      const pageLines = pageIndex.get(page);
      if (!pageLines) continue;
      // A chapter's opening page carries the cover/colophon block ABOVE the
      // chapter title plus the title's own display lines. Both are navigation,
      // not knowledge, and the title already lives in the citation head. When
      // the chapter came from a running header there is no marker to anchor on,
      // so fall back to the topmost display heading on that page.
      const cutY =
        page === chapter.startPage
          ? (chapter.markerY ??
            pageLines.reduce(
              (top, line) => (line.size >= headingThreshold ? Math.max(top, line.y) : top),
              -Infinity
            ))
          : -Infinity;
      if (Number.isFinite(cutY)) {
        lines.push(...pageLines.filter((line) => line.y < cutY && line.size < headingThreshold));
      } else {
        lines.push(...pageLines);
      }
    }
    const blocks = linesToBlocks(lines, bodySize);
    blocksByChapter.push(blocks);

    const head = citationHead(input.metadata, chapter);
    chunkBlocks(blocks, options).forEach((chunk, i) => {
      chunks.push({
        id: `${id}#${chapter.index}-${String(i + 1).padStart(4, "0")}`,
        // The citation head is part of the TEXT, not just metadata (§3.4).
        text: `${head}\n\n${chunk.text}`,
        citation: head,
        chapterIndex: chapter.index,
        chapterLabel: chapter.label,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        tokens: estimateTokens(`${head}\n\n${chunk.text}`),
      });
    });
  });

  const totalTokens = chunks.reduce((sum, c) => sum + c.tokens, 0);
  const stats: ProcessStats = {
    chunkCount: chunks.length,
    totalTokens,
    averageTokens: chunks.length === 0 ? 0 : Math.round(totalTokens / chunks.length),
    frontMatterPages,
    runningLinesRemoved: running.size,
    untitledChapters: chapters.filter((c) => !c.title).length,
  };

  const catalog: BookCatalogEntry = {
    id,
    metadata: input.metadata,
    knowledgeBase: knowledgeBaseName(input.metadata.jenjang, input.metadata.kelas),
    sourceFilename: input.sourceFilename,
    sizeBytes: input.sizeBytes,
    checksum: input.checksum,
    pageCount: input.pages.length,
    // The catalog carries the triage SUMMARY only — the per-page breakdown is
    // for the on-screen report, not for a file stored beside every book.
    triage: {
      totalPages: triage.totalPages,
      digitalPages: triage.digitalPages,
      ocrPages: triage.ocrPages,
      ocrRatio: triage.ocrRatio,
      verdict: triage.verdict,
    },
    chapters,
    chunkOptions: options,
    stats,
  };

  return {
    id,
    catalog,
    markdown: pagesToMarkdown(input.metadata, chapters, blocksByChapter),
    chunks,
    triage,
  };
}
