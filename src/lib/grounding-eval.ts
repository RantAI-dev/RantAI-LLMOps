/**
 * Scoring for a grounding eval: given examples shaped like the SFT dataset
 * (a citation-headed passage + a student question as `instruction`, the ideal
 * answer as `output`) plus what a model actually replied, produce the numbers a
 * study assistant has to be judged on.
 *
 * Deliberately deterministic — no LLM judge. Every number here can be explained
 * to a reviewer by pointing at the string it came from, it costs nothing to run,
 * and it does not drift between runs. Semantic answer quality is NOT scored; the
 * questions this answers are "did it refuse when it should have", "did it invent
 * an answer", and "did it cite the source it was given".
 */

/**
 * Answer strictly from the passage, refuse otherwise. Lives here rather than in
 * the route so the UI can offer it as an editable default: the prompt is the
 * cheapest grounding lever there is and deserves to be measured — a prompt-only
 * baseline is what tells you whether a fine-tune earned its cost.
 */
export const DEFAULT_GROUNDING_PROMPT = [
  "Kamu adalah tutor untuk siswa sekolah. Jawab HANYA berdasarkan KONTEKS yang diberikan.",
  "Aturan:",
  "- Kalau jawabannya ADA di konteks: jawab singkat dan jelas, lalu sebut sumbernya",
  "  dengan format (Sumber: <judul buku>, <bab>).",
  '- Kalau jawabannya TIDAK ADA di konteks: jawab persis "Maaf, informasi itu belum ada di materi yang tersedia."',
  "- JANGAN mengarang, menebak, atau memakai pengetahuan di luar konteks.",
  "- Sesuaikan bahasa dengan jenjang siswa yang disebutkan.",
].join("\n");

/** One row of the eval set — same shape as the training data. */
export type EvalExample = { instruction: string; output: string };

/** An example plus the model's reply, scored. */
export type ScoredCase = {
  instruction: string;
  expected: string;
  actual: string;
  /** "SD" | "SMP" | "SMA" when the prompt states one. */
  jenjang: string | null;
  /** The expected answer is a refusal — i.e. the passage does not contain it. */
  isNegative: boolean;
  /** The model's reply reads as a refusal. */
  modelRefused: boolean;
  /** "Buku IPA Kelas 3, Bab 2: Wujud Benda" parsed from the prompt's header. */
  citationExpected: string | null;
  /** The reply names that source. Only meaningful on answered positives. */
  citationOk: boolean;
  /** The reply invented an answer the passage does not support. */
  hallucinated: boolean;
  /** Rough lexical overlap with the ideal answer, 0..1 — a TRIAGE AID only.
   *  Reading a failure list, "right answer with no citation" and "wrong answer"
   *  look identical without it, and they are very different problems. It is not
   *  reported as a headline number: shared words are not shared meaning. */
  contentOverlap: number;
};

export type GroundingReport = {
  total: number;
  positives: number;
  negatives: number;
  /** Negatives correctly refused, 0..1. Higher is better. */
  refusalAccuracy: number;
  /** Negatives answered anyway, 0..1. Lower is better — this is "ngarang". */
  hallucinationRate: number;
  /** Positives wrongly refused, 0..1. Lower is better — over-refusal frustrates
   *  students just as much as invention misleads them. */
  overRefusalRate: number;
  /** Answered positives carrying the right source, 0..1. Higher is better. */
  citationAccuracy: number;
  /** The same four numbers per jenjang, since register and difficulty differ. */
  byJenjang: Record<string, Omit<GroundingReport, "byJenjang">>;
};

/**
 * Phrases that count as a refusal. The dataset's own refusal is the first one;
 * the rest catch a model that refuses in its own words rather than verbatim,
 * which would otherwise be scored as a hallucination.
 */
const REFUSAL_PATTERNS: RegExp[] = [
  /belum ada di materi/i,
  /tidak ada di materi/i,
  /tidak terdapat (?:di|dalam) materi/i,
  /tidak dijelaskan (?:di|dalam) materi/i,
  /tidak tersedia (?:di|dalam) materi/i,
  /maaf[^.]{0,40}materi/i,
];

export function looksLikeRefusal(text: string): boolean {
  return REFUSAL_PATTERNS.some((re) => re.test(text));
}

/** "[Buku IPA Kelas 3, Bab 2: Wujud Benda]" → the text inside the brackets. */
export function parseCitation(instruction: string): string | null {
  const m = /^\s*\[([^\]]+)\]/.exec(instruction);
  return m ? m[1].trim() : null;
}

/** "Jenjang siswa: SMP" → "SMP". */
export function parseJenjang(instruction: string): string | null {
  const m = /Jenjang siswa:\s*([A-Za-z]+)/i.exec(instruction);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Whether `reply` names the source it was given. Compared on the book and
 * chapter separately so wording around them ("Sumber:", "menurut", …) and
 * punctuation differences do not decide the outcome.
 */
export function citesSource(reply: string, citation: string | null): boolean {
  if (!citation) return false;
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const haystack = norm(reply);
  // "Buku IPA Kelas 3, Bab 2: Wujud Benda" → require the book and the chapter
  // NUMBER only. What follows the colon is the chapter's title, and a reply that
  // says "(Sumber: Buku IPA Kelas 3, Bab 2)" has identified the source exactly.
  // Demanding the title too scored a model that cited every single answer
  // correctly as never citing at all.
  const parts = citation
    .split(",")
    .map((part) => norm(part.split(":")[0]))
    .filter(Boolean);
  return parts.every((part) => haystack.includes(part));
}

/** Words too common to say anything about whether two answers agree. */
const STOPWORDS = new Set([
  "yang", "dan", "di", "ke", "dari", "itu", "ini", "adalah", "atau", "pada",
  "dengan", "untuk", "dalam", "akan", "tidak", "juga", "sebagai", "oleh",
  "karena", "bahwa", "dapat", "ada", "sumber", "buku", "bab", "kelas",
]);

function contentWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      // Drop the citation so a missing source does not also look like missing content.
      .replace(/\(sumber:[^)]*\)/g, " ")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w))
  );
}

/**
 * Rough lexical overlap with the ideal answer, 0..1. A triage aid for reading
 * the failure list — NOT a correctness score. It answers "did the model say
 * roughly the same thing", which is enough to tell a missing citation apart from
 * a wrong answer, and nothing more.
 */
export function contentOverlap(actual: string, expected: string): number {
  const want = contentWords(expected);
  const got = contentWords(actual);
  if (want.size === 0 || got.size === 0) return 0;
  let hit = 0;
  for (const w of want) if (got.has(w)) hit++;
  // Measured against the SMALLER set. A correct answer is often more concise
  // than the ideal one ("Pencernaan dimulai dari mulut." against an ideal that
  // also describes the teeth and saliva); dividing by the ideal's length
  // punished brevity and made short-but-right answers look wrong.
  return hit / Math.min(want.size, got.size);
}

export function scoreCase(example: EvalExample, actual: string): ScoredCase {
  const isNegative = looksLikeRefusal(example.output);
  const modelRefused = looksLikeRefusal(actual);
  const citationExpected = parseCitation(example.instruction);
  return {
    instruction: example.instruction,
    expected: example.output,
    actual,
    jenjang: parseJenjang(example.instruction),
    isNegative,
    modelRefused,
    citationExpected,
    // Only answered positives can cite correctly; a refusal has nothing to cite.
    citationOk: !isNegative && !modelRefused && citesSource(actual, citationExpected),
    // Answering a question the passage cannot support IS the hallucination we care
    // about — it is what puts a wrong fact in front of a child.
    hallucinated: isNegative && !modelRefused,
    contentOverlap: isNegative ? 0 : contentOverlap(actual, example.output),
  };
}

function summarise(cases: ScoredCase[]): Omit<GroundingReport, "byJenjang"> {
  const negatives = cases.filter((c) => c.isNegative);
  const positives = cases.filter((c) => !c.isNegative);
  const answeredPositives = positives.filter((c) => !c.modelRefused);
  const ratio = (n: number, d: number) => (d === 0 ? 0 : n / d);
  return {
    total: cases.length,
    positives: positives.length,
    negatives: negatives.length,
    refusalAccuracy: ratio(negatives.filter((c) => c.modelRefused).length, negatives.length),
    hallucinationRate: ratio(negatives.filter((c) => c.hallucinated).length, negatives.length),
    overRefusalRate: ratio(positives.filter((c) => c.modelRefused).length, positives.length),
    // Denominator is answered positives: a positive the model refused is already
    // counted as over-refusal, and counting it again as a citation miss would
    // punish the same mistake twice and hide how good the citations really are.
    citationAccuracy: ratio(answeredPositives.filter((c) => c.citationOk).length, answeredPositives.length),
  };
}

export function buildReport(cases: ScoredCase[]): GroundingReport {
  const byJenjang: Record<string, Omit<GroundingReport, "byJenjang">> = {};
  for (const jenjang of new Set(cases.map((c) => c.jenjang).filter(Boolean) as string[])) {
    byJenjang[jenjang] = summarise(cases.filter((c) => c.jenjang === jenjang));
  }
  return { ...summarise(cases), byJenjang };
}

/** Parse an eval set from JSONL, skipping blank lines. Throws on a malformed row
 *  so a truncated file fails loudly instead of scoring a partial set. */
export function parseEvalJsonl(text: string): EvalExample[] {
  const rows: EvalExample[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Baris ${i + 1} bukan JSON yang valid`);
    }
    const row = parsed as Partial<EvalExample>;
    if (typeof row?.instruction !== "string" || typeof row?.output !== "string") {
      throw new Error(`Baris ${i + 1} harus punya kolom "instruction" dan "output"`);
    }
    rows.push({ instruction: row.instruction, output: row.output });
  });
  if (rows.length === 0) throw new Error("File eval kosong");
  return rows;
}
