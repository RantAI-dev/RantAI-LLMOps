import { describe, expect, it } from "vitest";

import {
  buildReport,
  citesSource,
  looksLikeRefusal,
  parseCitation,
  parseEvalJsonl,
  parseJenjang,
  scoreCase,
  type EvalExample,
} from "@/lib/grounding-eval";

const PASSAGE = "[Buku IPA Kelas 3, Bab 2: Wujud Benda]\nBenda punya tiga wujud.\n\nJenjang siswa: SD\n";
const TOLAK = "Maaf, informasi itu belum ada di materi yang tersedia.";

const positif: EvalExample = {
  instruction: `${PASSAGE}Pertanyaan siswa: Ada berapa wujud benda?`,
  output: "Ada tiga wujud benda. (Sumber: Buku IPA Kelas 3, Bab 2: Wujud Benda)",
};
const negatif: EvalExample = {
  instruction: `${PASSAGE}Pertanyaan siswa: Siapa presiden pertama Indonesia?`,
  output: TOLAK,
};

describe("looksLikeRefusal", () => {
  it("matches the dataset's refusal and reworded ones", () => {
    for (const text of [
      TOLAK,
      "Informasi itu tidak ada di materi.",
      "Hal tersebut tidak dijelaskan dalam materi yang diberikan.",
      "Maaf, hal itu di luar materi ini.",
    ]) {
      expect(looksLikeRefusal(text), text).toBe(true);
    }
  });

  it("does not mistake a real answer for a refusal", () => {
    for (const text of [
      "Ada tiga wujud benda. (Sumber: Buku IPA Kelas 3, Bab 2: Wujud Benda)",
      "Presiden pertama Indonesia adalah Soekarno.",
      "Maaf, saya ulangi: jawabannya tiga.", // apologises but still answers
    ]) {
      expect(looksLikeRefusal(text), text).toBe(false);
    }
  });
});

describe("parseCitation / parseJenjang", () => {
  it("reads the citation header and the grade", () => {
    expect(parseCitation(positif.instruction)).toBe("Buku IPA Kelas 3, Bab 2: Wujud Benda");
    expect(parseJenjang(positif.instruction)).toBe("SD");
  });

  it("returns null when absent", () => {
    expect(parseCitation("Tidak ada kepala sitasi")).toBeNull();
    expect(parseJenjang("Tidak ada jenjang")).toBeNull();
  });
});

describe("grading against multi-passage context", () => {
  // What real retrieval looks like: several passages, the answer in one of them.
  const multi: EvalExample = {
    instruction:
      "[Buku Geografi Kelas 10, Bab 4: Dinamika Litosfer]\nLitosfer adalah lapisan kulit bumi.\n\n" +
      "[Buku IPA Kelas 3, Bab 2: Wujud Benda]\nBenda punya tiga wujud.\n\n" +
      "Jenjang siswa: SD\nPertanyaan siswa: Ada berapa wujud benda?",
    output: "Ada tiga wujud benda. (Sumber: Buku IPA Kelas 3, Bab 2: Wujud Benda)",
  };

  it("grades against the source the ideal answer names, not the first header", () => {
    const c = scoreCase(multi, "Ada tiga wujud benda. (Sumber: Buku IPA Kelas 3, Bab 2)");
    // The first header is the Geografi passage; grading against it would have
    // marked a perfectly cited answer wrong.
    expect(c.citationExpected).toBe("Buku IPA Kelas 3, Bab 2: Wujud Benda");
    expect(c.citationOk).toBe(true);
  });

  it("still catches a reply that cites the wrong passage from the context", () => {
    const c = scoreCase(multi, "Ada tiga wujud benda. (Sumber: Buku Geografi Kelas 10, Bab 4)");
    expect(c.citationOk).toBe(false);
  });
});

describe("citesSource", () => {
  const citation = "Buku IPA Kelas 3, Bab 2: Wujud Benda";

  it("accepts any wording that names book and chapter", () => {
    for (const reply of [
      "Ada tiga. (Sumber: Buku IPA Kelas 3, Bab 2: Wujud Benda)",
      "Menurut Buku IPA Kelas 3   pada Bab 2: Wujud Benda, ada tiga.",
    ]) {
      expect(citesSource(reply, citation), reply).toBe(true);
    }
  });

  it("accepts the chapter number without its title", () => {
    // What a model that cites well actually writes. Requiring the title too
    // scored a perfectly-citing model as never citing.
    expect(citesSource("Ada tiga. (Sumber: Buku IPA Kelas 3, Bab 2)", citation)).toBe(true);
  });

  it("rejects a missing, partial or wrong source", () => {
    expect(citesSource("Ada tiga wujud benda.", citation)).toBe(false);
    expect(citesSource("Sumber: Buku IPA Kelas 3", citation)).toBe(false); // no chapter
    expect(citesSource("Sumber: Buku IPA Kelas 5, Bab 2", citation)).toBe(false); // wrong book
    expect(citesSource("Sumber: Buku IPA Kelas 3, Bab 7", citation)).toBe(false); // wrong chapter
    expect(citesSource("apa pun", null)).toBe(false);
  });
});

describe("scoreCase", () => {
  it("scores an answered positive that cites correctly", () => {
    const c = scoreCase(positif, "Ada tiga wujud benda. (Sumber: Buku IPA Kelas 3, Bab 2: Wujud Benda)");
    expect(c).toMatchObject({ isNegative: false, modelRefused: false, citationOk: true, hallucinated: false });
  });

  it("flags a positive the model wrongly refused", () => {
    const c = scoreCase(positif, TOLAK);
    expect(c).toMatchObject({ modelRefused: true, citationOk: false, hallucinated: false });
  });

  it("flags a negative the model answered anyway as hallucination", () => {
    const c = scoreCase(negatif, "Presiden pertama Indonesia adalah Soekarno.");
    expect(c).toMatchObject({ isNegative: true, modelRefused: false, hallucinated: true });
  });

  it("counts a correctly refused negative as clean", () => {
    const c = scoreCase(negatif, TOLAK);
    expect(c).toMatchObject({ isNegative: true, modelRefused: true, hallucinated: false });
  });
});

describe("contentOverlap", () => {
  it("is high when the answer says the same thing without the citation", () => {
    const c = scoreCase(positif, "Ada tiga wujud benda.");
    // The point of this number: tell "right answer, no source" apart from "wrong".
    expect(c.citationOk).toBe(false);
    expect(c.contentOverlap).toBeGreaterThanOrEqual(0.5);
  });

  it("is low when the answer is about something else", () => {
    const c = scoreCase(positif, "Presiden pertama Indonesia adalah Soekarno.");
    expect(c.contentOverlap).toBeLessThan(0.5);
  });

  it("does not punish a correct answer for being more concise than the ideal", () => {
    const verbose: EvalExample = {
      instruction: positif.instruction,
      output: "Pencernaan makanan dimulai dari mulut. Di mulut, gigi mengunyah makanan dan air liur membantu melunakkannya.",
    };
    const c = scoreCase(verbose, "Pencernaan makanan dimulai dari mulut.");
    expect(c.contentOverlap).toBeGreaterThanOrEqual(0.9);
  });

  it("ignores the citation itself so a missing source is not read as missing content", () => {
    const withCite = scoreCase(positif, "Ada tiga wujud benda. (Sumber: Buku IPA Kelas 3, Bab 2: Wujud Benda)");
    const without = scoreCase(positif, "Ada tiga wujud benda.");
    expect(withCite.contentOverlap).toBeCloseTo(without.contentOverlap);
  });
});

describe("buildReport", () => {
  it("computes the four rates", () => {
    const cases = [
      scoreCase(positif, "Ada tiga wujud benda. (Sumber: Buku IPA Kelas 3, Bab 2: Wujud Benda)"), // cited
      scoreCase(positif, "Ada tiga wujud benda."), // answered, no citation
      scoreCase(positif, TOLAK), // over-refusal
      scoreCase(negatif, TOLAK), // correct refusal
      scoreCase(negatif, "Soekarno."), // hallucination
    ];
    const r = buildReport(cases);
    expect(r).toMatchObject({ total: 5, positives: 3, negatives: 2 });
    expect(r.refusalAccuracy).toBeCloseTo(0.5);
    expect(r.hallucinationRate).toBeCloseTo(0.5);
    expect(r.overRefusalRate).toBeCloseTo(1 / 3);
    // Denominator is ANSWERED positives (2), not all 3 — the refused one is
    // already counted as over-refusal.
    expect(r.citationAccuracy).toBeCloseTo(0.5);
  });

  it("breaks the same numbers down per jenjang", () => {
    const smp: EvalExample = {
      instruction: "[Buku IPS Kelas 7, Bab 3: Interaksi Sosial]\nisi.\n\nJenjang siswa: SMP\nPertanyaan siswa: apa?",
      output: TOLAK,
    };
    const r = buildReport([scoreCase(negatif, TOLAK), scoreCase(smp, "Jawaban ngarang.")]);
    expect(Object.keys(r.byJenjang).sort()).toEqual(["SD", "SMP"]);
    expect(r.byJenjang.SD.refusalAccuracy).toBe(1);
    expect(r.byJenjang.SMP.hallucinationRate).toBe(1);
  });

  it("reports zero rather than NaN when a bucket is empty", () => {
    const r = buildReport([scoreCase(positif, "Ada tiga.")]);
    expect(r.refusalAccuracy).toBe(0);
    expect(r.hallucinationRate).toBe(0);
  });
});

describe("parseEvalJsonl", () => {
  it("parses rows and skips blank lines", () => {
    const text = `${JSON.stringify(positif)}\n\n${JSON.stringify(negatif)}\n`;
    expect(parseEvalJsonl(text)).toHaveLength(2);
  });

  it("throws on malformed JSON, missing columns, or an empty file", () => {
    expect(() => parseEvalJsonl("{bukan json}")).toThrow(/Baris 1/);
    expect(() => parseEvalJsonl('{"instruction":"a"}')).toThrow(/instruction.*output/);
    expect(() => parseEvalJsonl("   \n\n")).toThrow(/kosong/);
  });
});
