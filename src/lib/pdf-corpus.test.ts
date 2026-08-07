import { describe, expect, it } from "vitest";

import {
  bookLabel,
  chunkBlocks,
  citationHead,
  corpusKeys,
  detectChapters,
  estimateTokens,
  findRunningLines,
  knowledgeBaseName,
  linesToBlocks,
  processBook,
  toLines,
  triagePages,
  type BookMetadata,
  type PdfLine,
  type PdfPage,
  type PdfTextItem,
} from "@/lib/pdf-corpus";

const META: BookMetadata = {
  title: "Buku IPA",
  penerbit: "Kemendikbud",
  mataPelajaran: "IPA",
  jenjang: "SD",
  kelas: 3,
  kurikulum: "Merdeka",
};

/** Build a text run. PDF y grows UPWARD, so a larger `y` is higher on the page. */
function run(text: string, y: number, size = 10, x = 50): PdfTextItem {
  return { text, size, x, y };
}

/** Build a page from runs, deliberately unsorted to exercise the ordering. */
function page(pageNumber: number, items: PdfTextItem[]): PdfPage {
  return { pageNumber, items };
}

function line(text: string, size: number, y: number, pageNumber = 1): PdfLine {
  return { text, size, y, pageNumber };
}

describe("toLines", () => {
  it("reads a page top-to-bottom, left-to-right regardless of content-stream order", () => {
    const lines = toLines(
      page(1, [run("world", 700, 10, 90), run("bottom", 100), run("hello", 700, 10, 10)])
    );
    expect(lines.map((l) => l.text)).toEqual(["hello world", "bottom"]);
  });

  it("keeps a display numeral off the title line beside it", () => {
    // The real failure this guards: "1" set at 50pt shares a baseline with the
    // 30pt "Tuhan Yang" next to it. Merging them makes one 50pt line, which then
    // masquerades as the chapter's dominant title size.
    const lines = toLines(page(1, [run("1", 357, 50, 40), run("Tuhan Yang", 355, 30, 200)]));
    expect(lines.map((l) => l.text)).toEqual(["1", "Tuhan Yang"]);
  });

  it("does not insert a space where a word was split at a kerning pair", () => {
    // "obser" is 30 wide and starts at x=10, so "vasi" at x=40 abuts it exactly.
    const lines = toLines(
      page(1, [
        { text: "obser", size: 10, x: 10, y: 700, width: 30 },
        { text: "vasi", size: 10, x: 40, y: 700, width: 20 },
      ])
    );
    expect(lines[0].text).toBe("observasi");
  });

  it("does insert a space across a real gap", () => {
    const lines = toLines(
      page(1, [
        { text: "benda", size: 10, x: 10, y: 700, width: 30 },
        { text: "cair", size: 10, x: 46, y: 700, width: 20 },
      ])
    );
    expect(lines[0].text).toBe("benda cair");
  });
});

describe("triagePages", () => {
  it("flags text-thin pages as needing OCR and reports the ratio", () => {
    const body = "a".repeat(400);
    const report = triagePages([
      page(1, [run(body, 500)]),
      page(2, [run("Gambar 1.1", 500)]),
      page(3, [run(body, 500)]),
      page(4, [run(body, 500)]),
    ]);
    expect(report.ocrPages).toBe(1);
    expect(report.digitalPages).toBe(3);
    expect(report.ocrRatio).toBeCloseTo(0.25, 5);
    expect(report.verdict).toBe("mixed");
  });

  it("sends a scanned book to the OCR queue instead of pretending it extracted", () => {
    const scanned = Array.from({ length: 6 }, (_, i) => page(i + 1, [run("12", 40)]));
    expect(triagePages(scanned).verdict).toBe("needs-ocr");
  });
});

describe("findRunningLines", () => {
  const LETTERS = "abcdefghijklmnopqrst";

  /**
   * A realistic page: a running header, several body lines, a page-number
   * footer. The header varies only by the (stripped) chapter/page number, while
   * the body wording is genuinely different on every page.
   */
  const bookPages = (bodyPrefix: string) =>
    Array.from({ length: 20 }, (_, i) =>
      page(i + 1, [
        run(`Bab 1 | Wujud Benda ${i + 10}`, 800, 9),
        ...Array.from({ length: 8 }, (_, l) =>
          run(`${bodyPrefix} ${LETTERS[i]}${LETTERS[l]} yang khas per halaman.`, 700 - l * 20)
        ),
        run(String(i + 10), 40, 9),
      ])
    );

  it("catches a header that differs only by its numbers", () => {
    const running = findRunningLines(bookPages("Isi").map(toLines));
    expect(running.has("bab wujud benda")).toBe(true);
  });

  it("leaves body text alone", () => {
    const running = findRunningLines(bookPages("Isi").map(toLines));
    expect([...running].some((k) => k.includes("khas per halaman"))).toBe(false);
  });

  it("removes the furniture from the cleaned text", () => {
    const book = processBook({
      pages: bookPages("Air adalah benda cair yang mengisi wadahnya, contoh"),
      metadata: META,
      sourceFilename: "ipa.pdf",
      sizeBytes: 1,
      checksum: "x",
    });
    expect(book.markdown).not.toContain("Wujud Benda 12");
    expect(book.markdown).toContain("Air adalah benda cair");
  });

  it("keeps the edge window proportional so a sparse page keeps its body", () => {
    // Six lines per page: a fixed 3-line edge window at each end would cover the
    // whole page, letting genuinely repeated body text be voted off as furniture.
    const pages = Array.from({ length: 20 }, (_, i) =>
      toLines(
        page(i + 1, [
          run("Judul Berulang", 800, 9),
          run(`Baris kedua ${LETTERS[i]}`, 700),
          run("Kalimat inti yang memang berulang.", 600),
          run("Kalimat inti kedua yang juga berulang.", 500),
          run(`Baris kelima ${LETTERS[i]}`, 400),
          run(String(i + 10), 40, 9),
        ])
      )
    );
    const running = findRunningLines(pages);
    expect(running.has("judul berulang")).toBe(true);
    expect(running.has("kalimat inti yang memang berulang")).toBe(false);
    expect(running.has("kalimat inti kedua yang juga berulang")).toBe(false);
  });
});

describe("detectChapters", () => {
  const bodySize = 10;

  /** A chapter opener: big "Bab N" marker plus a big title, then body text. */
  function opener(pageNumber: number, marker: string, title: string): PdfLine[] {
    return [
      line(marker, 18, 400, pageNumber),
      line(title, 24, 300, pageNumber),
      line("Isi bab dimulai di sini dengan kalimat biasa.", bodySize, 200, pageNumber),
    ];
  }

  it("reads chapters from typography and normalises roman numerals", () => {
    const pages = [
      opener(5, "BAB I", "WUJUD BENDA"),
      [line("lanjutan isi bab", bodySize, 500, 6)],
      opener(7, "BAB IV", "GAYA DAN GERAK"),
    ];
    const chapters = detectChapters(pages, pages, bodySize, 9);
    expect(chapters.map((c) => c.label)).toEqual([
      "Bab 1: WUJUD BENDA",
      "Bab 4: GAYA DAN GERAK",
    ]);
    expect(chapters[0]).toMatchObject({ startPage: 5, endPage: 6, source: "heading" });
    expect(chapters[1]).toMatchObject({ startPage: 7, endPage: 9 });
  });

  it("keeps chapters whose printed number could not be read", () => {
    // Regression: comparing empty numbers as "equal" collapsed every
    // number-less chapter into one, silently losing most of the book.
    const pages = [opener(2, "Bab", "SATU"), opener(4, "Bab", "DUA"), opener(6, "Bab", "TIGA")];
    const chapters = detectChapters(pages, pages, bodySize, 8);
    expect(chapters.map((c) => c.title)).toEqual(["SATU", "DUA", "TIGA"]);
  });

  it("falls back to the running header when typography finds nothing", () => {
    const raw = [
      [line("Bab 1 | Beragam Jalan 17", 9, 800, 17), line("isi", bodySize, 500, 17)],
      [line("Bab 2 | Pahlawanku 40", 9, 800, 40), line("isi", bodySize, 500, 40)],
    ];
    // The cleaned view has the furniture stripped, which is exactly why the
    // raw view has to be consulted for this fallback.
    const cleaned = [[line("isi", bodySize, 500, 17)], [line("isi", bodySize, 500, 40)]];
    const chapters = detectChapters(raw, cleaned, bodySize, 60);
    expect(chapters.map((c) => c.label)).toEqual([
      "Bab 1: Beragam Jalan",
      "Bab 2: Pahlawanku",
    ]);
    expect(chapters[0].source).toBe("running-header");
  });

  it("prefers the PDF's own bookmarks and skips front matter", () => {
    const pages = [opener(5, "BAB I", "SALAH BACA")];
    const chapters = detectChapters(pages, pages, bodySize, 40, [
      { title: "Kata Pengantar", pageNumber: 3 },
      { title: "Bab 1 Wujud Benda", pageNumber: 10 },
      { title: "Bab 2 Gaya dan Gerak", pageNumber: 25 },
    ]);
    expect(chapters.map((c) => c.source)).toEqual(["outline", "outline"]);
    expect(chapters.map((c) => c.label)).toEqual([
      "Bab 1: Wujud Benda",
      "Bab 2: Gaya dan Gerak",
    ]);
    expect(chapters[0].endPage).toBe(24);
  });

  it("still produces one citable section for a book with no structure", () => {
    const pages = [[line("teks biasa saja", bodySize, 500, 1)]];
    const chapters = detectChapters(pages, pages, bodySize, 1);
    expect(chapters).toHaveLength(1);
    expect(chapters[0].source).toBe("fallback");
    expect(chapters[0].label).toBe("");
  });
});

describe("linesToBlocks", () => {
  it("rejoins a hyphenated wrap but keeps a real hyphen", () => {
    const blocks = linesToBlocks(
      [
        line("Gaya dapat men-", 10, 500),
        line("dorong benda sehingga bergerak.", 10, 490),
        line("Modul ini memakai e-", 10, 480),
        line("Modul sebagai sumber.", 10, 470),
      ],
      10
    );
    const text = blocks.map((b) => b.text).join(" ");
    expect(text).toContain("mendorong benda");
    expect(text).toContain("e-Modul");
  });

  it("treats a lettered sub-head as a heading even at body size", () => {
    const blocks = linesToBlocks(
      [line("A. Membandingkan Informasi", 10, 500), line("Isi paragrafnya di sini.", 10, 480)],
      10
    );
    expect(blocks[0]).toMatchObject({ kind: "heading", text: "A. Membandingkan Informasi" });
  });
});

describe("chunkBlocks", () => {
  const paragraph = (n: number) => ({
    kind: "paragraph" as const,
    text: `Kalimat nomor ${n}. `.repeat(20).trim(), // ~100 tokens
    pageNumber: n,
  });

  it("fills chunks up to the target instead of emitting fragments", () => {
    const chunks = chunkBlocks(
      Array.from({ length: 12 }, (_, i) => paragraph(i + 1)),
      { targetTokens: 500, overlapPercent: 15 }
    );
    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk but the last should be within reach of the target.
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.tokens).toBeGreaterThan(250);
      expect(chunk.tokens).toBeLessThanOrEqual(500);
    }
  });

  it("carries the tail of a chunk into the next one as overlap", () => {
    // Regression: carrying whole BLOCKS produced no overlap at all here, because
    // one textbook paragraph is already larger than the entire 15% budget.
    const chunks = chunkBlocks(
      Array.from({ length: 12 }, (_, i) => paragraph(i + 1)),
      { targetTokens: 500, overlapPercent: 15 }
    );
    const carried = chunks[1].text.split("\n\n")[0];
    expect(chunks[0].text).toContain(carried);
    expect(estimateTokens(carried)).toBeGreaterThan(0);
    expect(estimateTokens(carried)).toBeLessThanOrEqual(250);
  });

  it("emits no overlap at all when asked for none", () => {
    const chunks = chunkBlocks(
      Array.from({ length: 8 }, (_, i) => paragraph(i + 1)),
      { targetTokens: 300, overlapPercent: 0 }
    );
    const carried = chunks[1].text.split("\n\n")[0];
    expect(chunks[0].text).not.toContain(carried);
  });

  it("does not break at a sub-heading that would leave a stub chunk", () => {
    // A textbook heads nearly every exercise; breaking on each one shreds the
    // chapter into unusable fragments.
    const blocks = [
      { kind: "heading" as const, text: "1. Bentuklah kelompok", pageNumber: 1 },
      paragraph(1),
      { kind: "heading" as const, text: "2. Tentukan pembagian tugas", pageNumber: 1 },
      paragraph(2),
    ];
    expect(chunkBlocks(blocks, { targetTokens: 500, overlapPercent: 15 })).toHaveLength(1);
  });

  it("splits an over-long paragraph at a sentence end", () => {
    const long = {
      kind: "paragraph" as const,
      text: "Ini kalimat panjang sekali yang berulang. ".repeat(60),
      pageNumber: 1,
    };
    const chunks = chunkBlocks([long], { targetTokens: 200, overlapPercent: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokens).toBeLessThanOrEqual(220);
      expect(chunk.text.trim()).toMatch(/\.$/);
    }
  });
});

describe("citationHead", () => {
  const chapter = {
    index: 2,
    number: "2",
    title: "Wujud Benda",
    label: "Bab 2: Wujud Benda",
    startPage: 10,
    endPage: 20,
    source: "heading" as const,
  };

  it("matches the citation form the plan specifies", () => {
    expect(citationHead(META, chapter)).toBe("[Buku IPA Kelas 3, Bab 2: Wujud Benda]");
  });

  it("does not repeat a kelas the title already carries", () => {
    expect(bookLabel({ ...META, title: "Bahasa Indonesia Kelas X" })).toBe(
      "Bahasa Indonesia Kelas X"
    );
  });

  it("degrades to the book alone when the chapter is unknown", () => {
    expect(citationHead(META, { ...chapter, label: "" })).toBe("[Buku IPA Kelas 3]");
  });
});

describe("storage layout", () => {
  it("names the knowledge base per the plan's convention", () => {
    expect(knowledgeBaseName("SD", 3)).toBe("sdkelas3");
    expect(knowledgeBaseName("SMA", 10)).toBe("smakelas10");
  });

  it("puts jenjang, kelas and mata pelajaran in the object key", () => {
    const keys = corpusKeys("buku-ipa-sd-3", META, "/corpus/");
    expect(keys.raw).toBe("corpus/raw/sd/kelas-3/ipa/buku-ipa-sd-3.pdf");
    expect(keys.chunks).toBe("corpus/chunks/sd/kelas-3/ipa/buku-ipa-sd-3.jsonl");
    expect(keys.catalog).toBe("corpus/catalog/sd/kelas-3/ipa/buku-ipa-sd-3.json");
  });
});

describe("processBook", () => {
  const body = (n: number) =>
    `Benda padat mempunyai bentuk yang tetap seperti batu dan kayu. Contoh ke-${n}. `.repeat(10);

  const book = processBook({
    pages: [
      page(1, [run("Daftar Isi", 700, 20), run("Bab 1 .... 2", 600)]),
      page(2, [run("Bab 1", 700, 18), run("WUJUD BENDA", 600, 24), run(body(1), 400)]),
      page(3, [run(body(2), 700)]),
      page(4, [run("Bab 2", 700, 18), run("GAYA DAN GERAK", 600, 24), run(body(3), 400)]),
    ],
    metadata: META,
    sourceFilename: "ipa-kelas-3.pdf",
    sizeBytes: 2048,
    checksum: "deadbeef",
  });

  it("drops the front matter that precedes chapter one", () => {
    expect(book.catalog.stats.frontMatterPages).toBe(1);
    expect(book.markdown).not.toContain("Daftar Isi");
  });

  it("prefixes every chunk with its citation head", () => {
    expect(book.chunks.length).toBeGreaterThan(0);
    for (const chunk of book.chunks) {
      expect(chunk.text.startsWith(chunk.citation)).toBe(true);
      expect(chunk.citation).toMatch(/^\[Buku IPA Kelas 3, Bab \d/);
    }
  });

  it("records the metadata a corpus catalog needs", () => {
    expect(book.catalog).toMatchObject({
      knowledgeBase: "sdkelas3",
      checksum: "deadbeef",
      pageCount: 4,
      sourceFilename: "ipa-kelas-3.pdf",
    });
    expect(book.catalog.stats.chunkCount).toBe(book.chunks.length);
  });

  it("attributes chunks to the chapter they were cut from", () => {
    const chapters = new Set(book.chunks.map((c) => c.chapterLabel));
    expect(chapters).toEqual(new Set(["Bab 1: WUJUD BENDA", "Bab 2: GAYA DAN GERAK"]));
  });
});

describe("estimateTokens", () => {
  it("is proportional to length and zero for blank text", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("   ")).toBe(0);
    expect(estimateTokens("a".repeat(380))).toBe(100);
  });
});
